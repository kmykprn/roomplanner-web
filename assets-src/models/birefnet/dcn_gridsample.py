"""torchvision.ops.deform_conv2d と同じ計算を、GridSample（ONNX の標準の演算）で書いたもの。

公開版の ONNX は deform_conv2d を GatherND で書いていて、カーネルの点の数（7×7 なら 49）ぶんの
入力を一度に並べる（[1, C×49, H, W] が 206MB）ため、ブラウザではメモリが足りない。
ここでは GridSample で点ごとに 1 枚ぶん（[1, C, H, W]）を取り出し、GROUP 点ぶんを束ねて 1 回の畳み込みで足し込む。

**1 点ずつ畳み込んで足し込む形にはしない。** 一見そのほうが同時に持つ量は少ないが、ブラウザの wasm では
1 点ごとの出力（128×128 で 16.8MB）の場所が再利用されず、49 点ぶんヒープが伸びた（最大 1.3GB）。
7 点ずつ束ねると大きな出力が 98 個から 14 個に減り、最大 0.78GB になる（25 点でも同じ、49 点では 0.83GB）。
対応するのは BiRefNet が使う形だけ（groups 1・offset groups 1・dilation 1・mask あり）。
"""
import torch
import torch.nn.functional as F

# 1 回の畳み込みに束ねる点の数
GROUP = 7


def deform_conv2d_gridsample(input, offset, weight, bias=None, stride=(1, 1), padding=(0, 0), dilation=(1, 1), mask=None):
    n, c, h, w = input.shape
    o, _, kh, kw = weight.shape
    sh, sw = (stride, stride) if isinstance(stride, int) else stride
    ph, pw = (padding, padding) if isinstance(padding, int) else padding
    dh, dw = (dilation, dilation) if isinstance(dilation, int) else dilation
    out_h, out_w = offset.shape[2], offset.shape[3]
    # 出力の各点が、入力のどこを見るか（オフセット無しのとき）
    base_y = (torch.arange(out_h, dtype=input.dtype) * sh - ph).view(1, out_h, 1)
    base_x = (torch.arange(out_w, dtype=input.dtype) * sw - pw).view(1, 1, out_w)
    taps = [(i, j) for i in range(kh) for j in range(kw)]
    out = None
    for start in range(0, len(taps), GROUP):
        group = taps[start : start + GROUP]
        sampled = []
        for i, j in group:
            k = i * kw + j
            y = base_y + i * dh + offset[:, 2 * k]
            x = base_x + j * dw + offset[:, 2 * k + 1]
            # 画素の中心を -1〜1 に直す（align_corners=False の約束）。枠の外は 0
            grid = torch.stack(((x + 0.5) / w * 2 - 1, (y + 0.5) / h * 2 - 1), dim=-1)
            s = F.grid_sample(input, grid, mode='bilinear', padding_mode='zeros', align_corners=False)
            if mask is not None:
                s = s * mask[:, k : k + 1]
            sampled.append(s)
        # [1, C×GROUP, H, W] に束ね、その点ぶんの重み [O, C×GROUP, 1, 1] で 1 回だけ畳み込む
        stacked = torch.cat(sampled, dim=1)
        wgt = torch.cat([weight[:, :, i, j] for i, j in group], dim=1).unsqueeze(-1).unsqueeze(-1)
        term = F.conv2d(stacked, wgt)
        out = term if out is None else out + term
    if bias is not None:
        out = out + bias.view(1, -1, 1, 1)
    return out


if __name__ == '__main__':
    import torchvision
    torch.manual_seed(0)
    for (c, o, k, s, p, hw) in [(64, 256, 1, 1, 0, 16), (64, 64, 3, 1, 1, 24), (64, 64, 7, 1, 3, 20), (32, 16, 3, 2, 1, 17)]:
        x = torch.randn(1, c, hw, hw); wgt = torch.randn(o, c, k, k) * 0.1; b = torch.randn(o)
        out_h = (hw + 2 * p - k) // s + 1
        off = torch.randn(1, 2 * k * k, out_h, out_h) * 2; m = torch.rand(1, k * k, out_h, out_h)
        ref = torchvision.ops.deform_conv2d(x, off, wgt, b, (s, s), (p, p), (1, 1), m)
        got = deform_conv2d_gridsample(x, off, wgt, b, (s, s), (p, p), (1, 1), m)
        print(f'k={k} s={s} p={p}: max |diff| = {(ref - got).abs().max():.2e}  (ref scale {ref.abs().mean():.2f})')

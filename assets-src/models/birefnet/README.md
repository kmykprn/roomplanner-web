# 切り抜きのモデル（`public/models/birefnet-lite-512-int8w.onnx`）の作り方

写真から家具を切り抜く [BiRefNet](https://github.com/ZhengPeng7/BiRefNet)（MIT）の軽い版（BiRefNet_lite）を、
ブラウザで動かせる形にしたもの。深度の AI と同じく onnxruntime-web でワーカーの中で動かす（`src/core/cutoutModel.ts`）。

## なぜ作り直したか

サーバーの切り抜き（Hunyuan3D-2GP の cutout/）は、公開されている 1024×1024 の ONNX をそのまま使っている。
それはブラウザでは動かない。

- 入力の大きさがファイルに固定されていて、1024 ではメモリが 6GB 要る（ブラウザの上限は 4GB）
- 変形畳み込み（deform_conv2d）が GatherND で書かれていて、カーネルの点の数（7×7 = 49）ぶんの入力を一度に並べる。
  512 に縮めても 206MB の中間データを何本も持つ

そこで元の重みから、次の 3 つを変えて書き出し直した。

1. **入力を 512×512 にする**（`export_lite_gs.py`）。輪郭は 1024 とほぼ同じ（合成写真 7 枚で重なり 0.90）
2. **変形畳み込みを GridSample で書く**（`dcn_gridsample.py`）。カーネルの点ごとに 1 枚ぶんだけ取り出して足し込む。
   torchvision の実装と差は 1e-5 以下。ブラウザのメモリは 2.1GB → 1.3GB
3. **重みだけ int8 にする**（`quantize_weights.py`。計算は fp32 のまま）。ついでに整数の定数を int16 にする（`shrink_constants.py`）。
   224MB → 52MB。結果は元とほぼ同じ（重なり 0.9995 以上）

PC のブラウザでの実測（1 スレッド）: 4.5 秒、メモリの最大 1.3GB（何もしないページは 0.6GB、深度の AI は 0.7GB）。

## 作り直す

Python 3.10 と GPU は要らない（CPU で数分）。

```sh
python -m venv .venv && .venv/bin/pip install torch torchvision transformers timm kornia einops onnx onnxruntime
.venv/bin/python export_lite_gs.py 512 birefnet-lite-512.onnx          # HF の ZhengPeng7/BiRefNet_lite を落として書き出す
.venv/bin/python quantize_weights.py birefnet-lite-512.onnx q.onnx
.venv/bin/python shrink_constants.py q.onnx ../../../public/models/birefnet-lite-512-int8w.onnx
```

入力は `input_image`（1×3×512×512、ImageNet の平均と分散で正規化）、出力は `output_image`（1×1×512×512 のロジット）。

"""BiRefNet_lite を、変形畳み込みを GridSample で書いたもの（dcn_gridsample.py）に差し替えて ONNX に書き出す。
使い方: python export_lite_gs.py <一辺> <出力.onnx>"""
import sys, torch, torchvision
from transformers import AutoModelForImageSegmentation
from dcn_gridsample import deform_conv2d_gridsample
size, out = int(sys.argv[1]), sys.argv[2]
model = AutoModelForImageSegmentation.from_pretrained('ZhengPeng7/BiRefNet_lite', trust_remote_code=True).eval()
# BiRefNet は `from torchvision.ops import deform_conv2d` で取り込んでいるので、そのモジュールの名前を差し替える
original = torchvision.ops.deform_conv2d
for m in list(sys.modules.values()):
    if getattr(m, 'deform_conv2d', None) is original: m.deform_conv2d = deform_conv2d_gridsample
x = torch.randn(1, 3, size, size)
with torch.no_grad():
    torch.onnx.export(model, x, out, input_names=['input_image'], output_names=['output_image'], opset_version=17, do_constant_folding=True, dynamo=False)
print('exported', out)

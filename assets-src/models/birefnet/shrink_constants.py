"""大きな定数（座標の格子。整数しか入っていない）を int16 で持ち、Cast で float に戻す。
値は 0〜262 なので int16 に収まる。計算結果は変わらない（Cast は正確）。
使い方: python shrink_constants.py in.onnx out.onnx"""
import sys, numpy as np, onnx
from onnx import numpy_helper, helper, TensorProto
m = onnx.load(sys.argv[1]); g = m.graph
new = []; n_done = 0; saved = 0
for node in list(g.node):
    if node.op_type != 'Constant' or not node.attribute or node.attribute[0].type != onnx.AttributeProto.TENSOR:
        new.append(node); continue
    t = helper.get_attribute_value(node.attribute[0])
    a = numpy_helper.to_array(t)
    if a.size < 1024 or a.dtype != np.float32 or not np.array_equal(a, np.round(a)) or np.abs(a).max() > 32767:
        new.append(node); continue
    out = node.output[0]
    g.initializer.append(numpy_helper.from_array(a.astype(np.int16), out + '_i16'))
    new.append(helper.make_node('Cast', [out + '_i16'], [out], to=TensorProto.FLOAT, name='cast_' + out))
    n_done += 1; saved += a.size * 2
del g.node[:]; g.node.extend(new)
onnx.checker.check_model(m, full_check=False); onnx.save(m, sys.argv[2])
print(f'shrunk {n_done} constants, saved about {saved/1e6:.0f} MB')

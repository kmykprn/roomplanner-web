"""重みだけを int8 にする（計算は fp32 のまま）。深度の AI（moge2-vits-int8w.onnx）と同じ作り。
Conv / MatMul / Gemm の重み（1024 要素以上）を、出力チャネルごとの対称量子化（零点 0）で int8 にし、
DequantizeLinear で元に戻してから計算に渡す。使い方: python quantize_weights.py in.onnx out.onnx"""
import sys
import numpy as np, onnx
from onnx import numpy_helper, helper, TensorProto
src, dst = sys.argv[1], sys.argv[2]
m = onnx.load(src)
g = m.graph
inits = {t.name: t for t in g.initializer}
# 重みを使う節: (入力の位置, チャネルの軸)
def weight_axis(node, idx):
    if node.op_type == 'Conv' and idx == 1: return 0
    if node.op_type == 'MatMul' and idx == 1: return -1  # [K, N] → N ごと
    if node.op_type == 'Gemm' and idx == 1:
        transB = next((a.i for a in node.attribute if a.name == 'transB'), 0)
        return 0 if transB else -1
    return None
done = {}; new_nodes = []; saved = 0
for node in g.node:
    for idx, name in enumerate(node.input):
        axis = weight_axis(node, idx)
        if axis is None or name not in inits: continue
        t = inits[name]
        if t.data_type != TensorProto.FLOAT: continue
        w = numpy_helper.to_array(t)
        if w.size < 1024: continue
        if name not in done:
            ax = axis % w.ndim
            reduce_axes = tuple(i for i in range(w.ndim) if i != ax)
            scale = np.maximum(np.abs(w).max(axis=reduce_axes, keepdims=True), 1e-8) / 127.0
            q = np.clip(np.round(w / scale), -127, 127).astype(np.int8)
            s = scale.reshape(-1).astype(np.float32); z = np.zeros_like(s, dtype=np.int8)
            g.initializer.remove(t)
            g.initializer.extend([numpy_helper.from_array(q, name + '_q'), numpy_helper.from_array(s, name + '_s'), numpy_helper.from_array(z, name + '_z')])
            new_nodes.append(helper.make_node('DequantizeLinear', [name + '_q', name + '_s', name + '_z'], [name], axis=ax, name='deq_' + name))
            done[name] = True; saved += w.size * 3
        # 入力名はそのまま（DequantizeLinear の出力が同じ名前）
# 使う節より前に置く（順番が要る）
nodes = list(g.node)
del g.node[:]
g.node.extend(new_nodes + nodes)
onnx.checker.check_model(m, full_check=False)
onnx.save(m, dst)
print(f'quantized {len(done)} weights, saved about {saved/1e6:.0f} MB')

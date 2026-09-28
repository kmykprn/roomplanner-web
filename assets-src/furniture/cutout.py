"""サンプルの元画像（白背景、inputs/）を BiRefNet で切り抜き、透過 WebP にする（src/assets/furniture/*-cutout.webp）。

要るもの: torch・torchvision・transformers・timm・kornia・einops と GPU。python cutout.py で作り直せる
"""
import torch, numpy as np
from PIL import Image
from torchvision import transforms
from transformers import AutoModelForImageSegmentation
import os
SRC = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'inputs')
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'src', 'assets', 'furniture')
model = AutoModelForImageSegmentation.from_pretrained('ZhengPeng7/BiRefNet', trust_remote_code=True).to('cuda').float().eval()
prep = transforms.Compose([transforms.Resize((1024, 1024)), transforms.ToTensor(), transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225])])
for name in ('chair', 'sofa'):
    img = Image.open(f'{SRC}/{name}.png').convert('RGB')
    with torch.no_grad():
        pred = model(prep(img).unsqueeze(0).to('cuda'))[-1].sigmoid().cpu()[0, 0]
    mask = transforms.ToPILImage()(pred).resize(img.size, Image.BILINEAR)
    rgba = img.copy(); rgba.putalpha(mask)
    # 物のまわりだけに切り詰め、少し余白を残す
    a = np.asarray(mask); ys, xs = np.nonzero(a > 16)
    pad = int(0.02 * max(img.size))
    box = (max(0, xs.min() - pad), max(0, ys.min() - pad), min(img.width, xs.max() + pad), min(img.height, ys.max() + pad))
    out = rgba.crop(box)
    out.thumbnail((768, 768))
    out.save(os.path.join(OUT, f'{name}-cutout.webp'), 'WEBP', quality=88, method=6)
    print(name, img.size, '->', out.size)

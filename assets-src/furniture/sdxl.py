"""画像生成（SDXL base 1.0、CreativeML Open RAIL++-M）で「白背景の商品写真」風の入力を作る。

  python sdxl.py <出力先> chair sofa ...

手元の GPU（12GB）で 1 枚 30 秒ほど。出力は 1024×1024 PNG（種ごとに 1 枚）。
背景が散らかったり形が崩れたりするので、種を変えて数枚作り、良いものを inputs/ に置く
"""
import sys, torch
from diffusers import StableDiffusionXLPipeline, AutoencoderKL

PROMPTS = {
    "chair": "a single ordinary wooden dining chair, four legs, straight back with horizontal slats, natural oak, correct proportions",
    "sofa": "a single modern two-seat sofa upholstered in slate blue fabric, wooden legs",
}
STYLE = ", e-commerce product photo, one object only, isolated cutout on a plain solid white background, nothing else in the frame, even studio lighting, no shadow, three-quarter view from slightly above, the whole object visible and centered with margin, photorealistic, sharp focus"
NEGATIVE = "background objects, props, plants, pattern, wall, floor, room, scenery, text, watermark, logo, brand, people, hands, multiple objects, duplicate, cropped, close-up, blurry, low quality, cartoon, illustration, deformed, extra legs"

out, items = sys.argv[1], sys.argv[2:]
vae = AutoencoderKL.from_pretrained("madebyollin/sdxl-vae-fp16-fix", torch_dtype=torch.float16)
pipe = StableDiffusionXLPipeline.from_pretrained("stabilityai/stable-diffusion-xl-base-1.0", vae=vae, torch_dtype=torch.float16, variant="fp16", use_safetensors=True)
pipe.enable_model_cpu_offload()
SEEDS = [11, 23]
for name in items:
    for seed in SEEDS:
        g = torch.Generator("cuda").manual_seed(seed)
        image = pipe(prompt=PROMPTS[name] + STYLE, negative_prompt=NEGATIVE, num_inference_steps=30, guidance_scale=7.0, width=1024, height=1024, generator=g).images[0]
        image.save(f"{out}/{name}-{seed}.png"); print("generated", name, seed, flush=True)

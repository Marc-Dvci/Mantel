"""Generate the demo household's sample photographs.

Every photograph in fixtures/media is generated here: the family portraits, the
old family photos shown as Moments, and the doorbell camera frames the Ring
simulator serves. The people in them do not exist.

    python -m venv .media-venv
    .media-venv/Scripts/pip install torch --index-url https://download.pytorch.org/whl/cu124
    .media-venv/Scripts/pip install diffusers transformers accelerate safetensors pillow
    .media-venv/Scripts/python tools/media/generate_images.py            # all
    .media-venv/Scripts/python tools/media/generate_images.py photo-sarah # one

Model: RealVisXL V4.0 Lightning (SDXL), six steps, fixed seeds, so a run
reproduces the same images on the same hardware and library versions.
"""

from __future__ import annotations

import sys
from pathlib import Path

import torch
from diffusers import DPMSolverMultistepScheduler, StableDiffusionXLPipeline
from PIL import Image, ImageFilter

OUT = Path(__file__).resolve().parents[2] / "fixtures" / "media"
MODEL = "SG161222/RealVisXL_V4.0_Lightning"

NEGATIVE = (
    "text, watermark, logo, signature, deformed hands, extra fingers, distorted face, cartoon, "
    "illustration, 3d render, oversaturated, blurry face"
)

VINTAGE = "authentic vintage photograph, film grain, faded colors, slightly soft focus, candid family snapshot"
DOORBELL = (
    "doorbell camera footage, wide angle fisheye lens, high vantage point looking down at a front porch, "
    "security camera image, slightly washed out daylight, suburban American house"
)

# name: (prompt, width, height, seed)
IMAGES: dict[str, tuple[str, int, int, int]] = {
    "photo-sarah": ("portrait photo of a warm smiling woman in her early fifties, shoulder length brown hair with some grey, "
                    "cardigan, soft window light in a living room, natural skin, looking at camera, 85mm", 896, 1152, 11),
    "photo-tom": ("portrait photo of a friendly young man aged about twenty two, short dark hair, casual sweater, "
                  "smiling, outdoor soft light, natural skin, looking at camera, 85mm", 896, 1152, 12),
    "photo-anna": ("portrait photo of a kind woman in her mid thirties, home care aide in a light blue top, hair tied back, "
                   "gentle smile, bright kitchen background, natural skin, looking at camera", 896, 1152, 13),
    "photo-robert": (f"{VINTAGE}, 1970s portrait of a man in his forties with a moustache and a checked shirt, smiling, "
                     "in a garden", 896, 1152, 14),
    "moment-tahoe-1968": (f"{VINTAGE}, 1968 kodachrome photo of a young married couple standing at the shore of Lake Tahoe, "
                          "pine trees and mountains, blue water, summer, woman in a sundress, man in short sleeves", 1216, 832, 21),
    "moment-wedding-1965": (f"{VINTAGE}, black and white 1965 wedding photograph, young bride in a lace dress and groom in a "
                            "dark suit on church steps, confetti", 1216, 832, 22),
    "moment-graduation-1994": (f"{VINTAGE}, 1994 photo of one young woman graduate in a gown and cap hugging her proud "
                               "middle-aged mother who wears a floral summer dress and no gown, university lawn, sunny day", 1216, 832, 27),
    "moment-biscuit-2015": ("photo of a golden retriever puppy sitting on a green lawn in a back garden, soft afternoon light, "
                            "sharp focus, joyful", 1216, 832, 24),
    "moment-roses": ("photo of pink and red climbing roses on a white wooden back porch railing, summer morning light, "
                     "garden, shallow depth of field", 1216, 832, 25),
    "moment-birthday-2004": (f"{VINTAGE}, 2004 digital snapshot of a one year old toddler boy in a high chair with a small "
                             "birthday cake and one candle, family kitchen, flash photography", 1216, 832, 26),
    "door-sarah": (f"{DOORBELL}, a woman in her fifties with brown hair and a raincoat standing at the front door holding a "
                   "bag of groceries, smiling", 1216, 832, 31),
    "door-stranger": (f"{DOORBELL}, a man in a baseball cap and a work jacket holding a clipboard standing at the front door",
                      1216, 832, 32),
    "door-courier": (f"{DOORBELL}, a delivery driver in a uniform holding a cardboard parcel at the front door", 1216, 832, 33),
    "door-empty": (f"{DOORBELL}, an empty front porch with a doormat and potted plants, nobody there", 1216, 832, 34),
}


def main(names: list[str]) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    pipe = StableDiffusionXLPipeline.from_pretrained(MODEL, torch_dtype=torch.float16, variant="fp16")
    pipe.scheduler = DPMSolverMultistepScheduler.from_config(pipe.scheduler.config, use_karras_sigmas=True, algorithm_type="sde-dpmsolver++")
    pipe.enable_model_cpu_offload()
    for name in names or list(IMAGES):
        prompt, w, h, seed = IMAGES[name]
        image: Image.Image = pipe(
            prompt=prompt,
            negative_prompt=NEGATIVE,
            width=w,
            height=h,
            num_inference_steps=6,
            guidance_scale=1.6,
            generator=torch.Generator("cuda").manual_seed(seed),
        ).images[0]
        if name.startswith("door-"):
            # A doorbell frame is a little softer than a photograph.
            image = image.filter(ImageFilter.GaussianBlur(0.6))
        long_side = 1280 if not name.startswith("photo-") else 720
        image.thumbnail((long_side, long_side))
        image.convert("RGB").save(OUT / f"{name}.jpg", quality=86)
        print("wrote", name)


if __name__ == "__main__":
    main(sys.argv[1:])

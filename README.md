# Image generation with Comfy UI

## Setup

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install pillow websocket-client
```

Install [ComfyUI](https://comfyui.org/), and download a template and model (e.g. `default`).


## Usage

Optional: *File* / *Export (API)* your workflow to `default.json`.

Ensure *Comfy UI* is running, and that the *Comfy UI* server is running.

```bash
source .venv/bin/activate
python comfy-image.py "A beautiful landscape with mountains and a river"
```

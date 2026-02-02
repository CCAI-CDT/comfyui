# ComfyUI Image Generation
# Dan Jackson, 2026.

# Based on information from: https://medium.com/@next.trail.tech/how-to-use-comfyui-api-with-python-a-complete-guide-f786da157d37

# Install: ComfyUI - https://comfyui.org/
# pip install pillow websockets

import sys
import os
import io
import datetime
import random
import uuid
import json
import urllib.request
import urllib.parse

from websockets.sync.client import connect
from PIL import Image

# Default values
default_server_address = "localhost:8000"  # "localhost:8000" "localhost:8188" 
default_prompt_file = 'default.json'

# Generate images via ComfyUI
def generate_image(inputs = None, server_address=default_server_address, prompt_file=default_prompt_file, paths=None):
    # If inputs is a string, assume only the prompt is given
    if isinstance(inputs, str):
        inputs = {'prompt': inputs}

    # If paths is a string, assume only the prompt path is given
    if isinstance(paths, str):
        paths = {'prompt': paths}

    # Read JSON prompt
    with open(prompt_file, 'r') as f:
        data = json.load(f)

    # Load path mappings if not already provided
    if paths is None:
        prompt_paths_file = prompt_file.rsplit('.', 1)[0] + '.paths.json'
        if os.path.exists(prompt_paths_file):
            with open(prompt_paths_file, 'r') as f:
                paths = json.load(f)

    # Set specified inputs
    if inputs is not None:
        for key in inputs:
            if paths is None:
                raise ValueError("Paths must be provided when inputs are specified")
            if key not in paths:
                raise ValueError(f"Path for input '{key}' was not found in paths")
            keys = paths[key].split('.')
            d = data
            for k in keys[:-1]:
                d = d[k]
            d[keys[-1]] = inputs[key]

    # Generate a unique client ID
    client_id = str(uuid.uuid4())

    websocket_url = f"ws://{server_address}/ws?clientId={client_id}"
    with connect(websocket_url) as ws:

        # Queue prompt
        p = {"prompt": data, "client_id": client_id}
        data = json.dumps(p).encode('utf-8')
        req = urllib.request.Request(f"http://{server_address}/prompt", data=data)
        queued_prompt = json.loads(urllib.request.urlopen(req).read())
        prompt_id = queued_prompt['prompt_id']

        # Monitor Execution Status
        while True:
            out = ws.recv()
            if isinstance(out, str):
                message = json.loads(out)
                if message['type'] == 'executing':
                    data = message['data']
                    if data['node'] is None and data['prompt_id'] == prompt_id:
                        break  # Execution complete
            else:
                # Binary data (preview images)
                continue

        # Get history
        with urllib.request.urlopen(f"http://{server_address}/history/{prompt_id}") as response:
            history_data = json.loads(response.read())
        history = history_data[prompt_id]

        # Get images
        def get_image(filename, subfolder, folder_type):
            data = {"filename": filename, "subfolder": subfolder, "type": folder_type}
            url_values = urllib.parse.urlencode(data)
            with urllib.request.urlopen(f"http://{server_address}/view?{url_values}") as response:
                return response.read()

        output_images = {}
        for node_id in history['outputs']:
            node_output = history['outputs'][node_id]
            images_output = []
            if 'images' in node_output:
                for image in node_output['images']:
                    image_data = get_image(image['filename'], image['subfolder'], image['type'])
                    images_output.append(image_data)
            output_images[node_id] = images_output

        # Process the generated images
        prefix = datetime.datetime.now().strftime("%Y%m%d-%H%M%S-%f-") + f"{random.randint(0, 999999):06d}"
        image_files = []
        for node_id in output_images:
            for image_data in output_images[node_id]:
                # Convert bytes to PIL Image
                image = Image.open(io.BytesIO(image_data))
                # Process image as needed
                image_filename = f"output_{prefix}_{node_id}.png"
                image.save(image_filename)
                image_files.append(image_filename)

    return image_files


if __name__ == "__main__":
    prompt_text = None
    if len(sys.argv) > 1:
        prompt_text = sys.argv[1]
    print("PROMPT:", prompt_text, file=sys.stderr)
    inputs = {
        'prompt': prompt_text,
        'seed': random.randint(0, 2**32 - 1),
    }
    image_files = generate_image(inputs)
    print("IMAGES:", image_files, file=sys.stderr)
    for image_file in image_files:
        print(image_file)

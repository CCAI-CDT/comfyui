# ComfyUI Image Generation
# Dan Jackson, 2026.

# Based on information from: https://medium.com/@next.trail.tech/how-to-use-comfyui-api-with-python-a-complete-guide-f786da157d37

# Install: ComfyUI - https://comfyui.org/
# pip install pillow websocket-client

import sys
import json
import uuid
import datetime
import random
import websocket
import urllib.request
import urllib.parse
import io
from PIL import Image

# Default values
default_server_address = "localhost:8000"
default_prompt_file = 'default.json'
default_prompt_path = '6.inputs.text'

# Generate images via ComfyUI
def generate_image(prompt_text = None, server_address=default_server_address, prompt_file=default_prompt_file, prompt_path=default_prompt_path):
    # Read JSON prompt
    with open(prompt_file, 'r') as f:
        data = json.load(f)

    # Follow dotted prompt_path to set the value from prompt
    if prompt_text is not None:
        if not prompt_path:
            raise ValueError("prompt_path must be provided if prompt_text is given")
        keys = prompt_path.split('.')
        d = data
        for key in keys[:-1]:
            d = d[key]
        d[keys[-1]] = prompt_text

    # Generate a unique client ID
    client_id = str(uuid.uuid4())

    ws = websocket.WebSocket()
    ws.connect(f"ws://{server_address}/ws?clientId={client_id}")

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

    # Close the WebSocket connection
    ws.close()

    return image_files


if __name__ == "__main__":
    prompt_text = None
    if len(sys.argv) > 1:
        prompt_text = sys.argv[1]
    print("PROMPT:", prompt_text, file=sys.stderr)
    image_files = generate_image(prompt_text)
    print("IMAGES:", image_files, file=sys.stderr)
    for image_file in image_files:
        print(image_file)

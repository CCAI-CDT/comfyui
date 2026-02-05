// ComfyUI Image Generation
// Dan Jackson, 2026.

class ComfyUI {

    static DEFAULT_SERVER_ADDRESS = "localhost:8000";  // "localhost:8000" "localhost:8188" 
    static DEFAULT_PROMPT_FILE = "default.json";

    constructor(serverAddress, promptData, paths = null) {
        this.serverAddress = serverAddress || ComfyUI.DEFAULT_SERVER_ADDRESS;
        this.promptData = promptData;
        this.paths = paths;
    }

    // Browser uses fetch API, otherwise use filesystem
    static async fetchFile(filename, text = true) {
        let result = null;
        if (filename) {
            if (typeof document !== "undefined") {
                try {
                    const response = await fetch(filename);
                    if (!response.ok) {
                        console.error(`Failed to fetch file '${filename}': ${response.status} ${response.statusText}`);
                        return null;
                    }
                    if (text) {
                        result = await response.text();
                    } else {
                        result = await response.arrayBuffer();
                    }
                } catch (err) {
                    console.error(`Error fetching file '${filename}':`, err);
                    return null;
                }
            } else {
                const fs = await import('node:fs');
                try {
                    if (text) {
                        result = await fs.promises.readFile(filename, 'utf-8');
                    } else {
                        result = await fs.promises.readFile(filename, null);
                        if (result instanceof Buffer) {
                            result = result.buffer.subarray(result.byteOffset, result.byteOffset + result.byteLength);
                        }
                    }
                } catch (err) {
                    console.error(`Error reading file '${filename}':`, err);
                    return null;
                }
            }
        }
        return result;
    }

    static async fetchPromptFile(promptFilename, promptPathsFile = true) {
        // Automatically determine paths filename
        if (promptPathsFile === true) {
            promptPathsFile = promptFilename.replace(/\.[^/.]+$/, "") + ".paths.json";
        }

        const rawPromptData = await ComfyUI.fetchFile(promptFilename);
        let rawPaths = await ComfyUI.fetchFile(promptPathsFile);

        const promptData = rawPromptData ? JSON.parse(rawPromptData) : null;
        const paths = rawPaths ? JSON.parse(rawPaths) : null;

        return {
            promptData: promptData,
            paths: paths,
        }
    }

    completePrompt(inputs, queryValues) {
        // If inputs is a string, assume only the prompt is given
        if (typeof inputs === 'string') {
            inputs = { 'text': inputs };
        }
        
        // Clone prompt JSON data
        const data = JSON.parse(JSON.stringify(this.promptData));

        // Set specified inputs
        if (inputs !== undefined && inputs !== null) {
            for (const key in inputs) {
                if (this.paths === undefined || this.paths === null || !(key in this.paths)) {
                    // Locate the first matching key, depth-first search
                    function findKey(obj, filter) {
                        if (obj != null && typeof obj === 'object') {
                            for (const [key, value] of Object.entries(obj)) {
                                if (!filter(obj, key, value)) {
                                    return false;
                                }
                                if (!findKey(value, filter)) {
                                    return false;
                                }
                            }
                        }
                        return true;
                    };
                    let found = false;
                    findKey(data, (o, k, v) => {
                        if (!found && k === key) {
                            if (queryValues) {
                                inputs[key ] = o[k];
                            } else {
                                o[k] = inputs[key];
                            }
                            found = true;
                        }
                        return !found;
                    });
                    if (!found) {
                        throw new Error(`Path for input '${key}' was not specified, and a search did not find a matching key in the prompt data.`);
                    }
                } else {
                    const keys = this.paths[key].split('.');
                    let d = data;
                    for (let i = 0; i < keys.length - 1; i++) {
                        d = d[keys[i]];
                    }
                    if (queryValues) {
                        inputs[key] = d[keys[keys.length - 1]];
                    } else {
                        d[keys[keys.length - 1]] = inputs[key];
                    }
                }
            }
        }

        return data;
    }

    async saveImages(imageResults) {
        const fs = await import('node:fs');
        // Process the generated images
        const nowMs = globalThis.performance ? performance.timeOrigin + performance.now() : Date.now();
        const microseconds = Math.floor(nowMs % 1000 * 1000);
        const now = new Date(nowMs);
        const prefix = now.getFullYear().toString().padStart(4, '0') + (now.getMonth() + 1).toString().padStart(2, '0') + now.getDate().toString().padStart(2, '0') + "-" +
                    now.getHours().toString().padStart(2, '0') + now.getMinutes().toString().padStart(2, '0') + now.getSeconds().toString().padStart(2, '0') + "-" +
                    microseconds.toString().padStart(6, '0') + "-" +
                    Math.floor(Math.random() * 1000000).toString().padStart(6, '0');
        const imageFiles = [];
        for (const image of imageResults) {
            // Save image data to file
            const imageFilename = `output_${prefix}_${image.node_id}_${image.index}.png`;
            await fs.promises.writeFile(imageFilename, Buffer.from(image.data));
            imageFiles.push({
                'node_id': image.node_id,
                'index': image.index,
                'filename': imageFilename,
            });
        }
        return imageFiles;
    }

    async generateImage(data) {
        const serverAddress = this.serverAddress;
        let ws = null;
        try {
            // Generate a unique client ID
            const clientId = crypto.randomUUID();

            // WebSocket URL
            const websocketUrl = `ws://${serverAddress}/ws?clientId=${clientId}`;

            ws = new WebSocket(websocketUrl);
            await new Promise((resolve, reject) => {
                ws.onopen = () => resolve();
                ws.onerror = (err) => reject(err);
            });

            // Queue prompt
            const p = { "prompt": data, "client_id": clientId };
            const response = await fetch(`http://${serverAddress}/prompt`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(p)
            });
            const queuedPrompt = await response.json();
            const promptId = queuedPrompt['prompt_id'];
            
            // Monitor Execution Status
            while (true) {
                const out = await new Promise((resolve) => {
                    ws.onmessage = (event) => resolve(event.data);
                });
                if (typeof out === 'string') {
                    const message = JSON.parse(out);
                    if (message['type'] === 'executing') {
                        const data = message['data'];
                        if (data['node'] === null && data['prompt_id'] === promptId) {
                            break;  // Execution complete
                        }
                    }
                } else {
                    // Binary data (preview images)
                    continue;
                }
            }

            // Get history
            const historyResponse = await fetch(`http://${serverAddress}/history/${promptId}`);
            const historyData = await historyResponse.json();
            const history = historyData[promptId];

            // Get images
            async function getImage(filename, subfolder, folderType) {
                const url = new URL(`http://${serverAddress}/view`);
                url.searchParams.append('filename', filename);
                url.searchParams.append('subfolder', subfolder);
                url.searchParams.append('type', folderType);
                const response = await fetch(url);
                return await response.arrayBuffer();
            }

            const outputImages = {};
            for (const nodeId in history['outputs']) {
                const nodeOutput = history['outputs'][nodeId];
                const imagesOutput = [];
                if ('images' in nodeOutput) {
                    for (const image of nodeOutput['images']) {
                        const imageData = await getImage(image['filename'], image['subfolder'], image['type']);
                        imagesOutput.push(imageData);
                    }
                }
                outputImages[nodeId] = imagesOutput;
            }

            const imageResults = [];
            for (const nodeId in outputImages) {
                for (let i = 0; i < outputImages[nodeId].length; i++) {
                    imageResults.push({
                        'node_id': nodeId,
                        'index': i,
                        'data': outputImages[nodeId][i],
                    });
                }
            }

            return imageResults;

        } catch (err) {
            console.error("Error generating image:", err);
            throw err;

        } finally {
            if (ws) {
                ws.close();
            }
        }

    }

}


// If run as a script
if (import.meta.main) {
    (async () => {
        const promptText = process.argv.length > 2 ? process.argv[2] : null;
        console.error("PROMPT:", promptText);
        const inputs = {
            'text': promptText,
            'seed': Math.floor(Math.random() * 2**32),
        };
        const { promptData, paths } = await ComfyUI.fetchPromptFile(ComfyUI.DEFAULT_PROMPT_FILE, true);
        const comfy = new ComfyUI(ComfyUI.DEFAULT_SERVER_ADDRESS, promptData, paths);
        const data = comfy.completePrompt(inputs);
        const imageResults = await comfy.generateImage(data);
        const imageFiles = await comfy.saveImages(imageResults);
        console.error("IMAGES:", imageFiles);
        for (const imageFile of imageFiles) {
            console.log(JSON.stringify(imageFile));
        }
    })();
}

// Hack to export only if imported as a module (top-level await a regexp divided, otherwise an undefined variable divided followed by a comment)
if(0)typeof await/0//0; export default ComfyUI;
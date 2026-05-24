import json
import urllib.request

def generate():
    prompt = """
You are an expert JavaScript developer.
I have a modal that displays command line flags. Each flag is represented by this DOM structure:
<div class="modal-body" id="flagsModalBody">
  <div class="flag-item">
    <div class="flag-name">-m, --model FNAME</div>
    <div class="flag-desc">model path</div>
  </div>
  ...
</div>

I have a command string that looks like this:
"/home/user/llama-server -m /path/to/model.gguf --port 8080 -c 65536 --flash-attn on"

Write a JavaScript function called `highlightActiveFlags(commandString)` that does the following:
1. Selects all `.flag-item` elements inside `#flagsModalBody`.
2. For each element, gets the text of its `.flag-name` child.
3. Uses a regular expression (like `/(-\\w+|--[\\w-]+)/g`) to extract all the actual flag names from the `.flag-name` text (ignoring argument placeholders like FNAME).
4. Checks if ANY of those extracted flag names exist as distinct tokens in the `commandString` (you can split the commandString by spaces to get the tokens).
5. If the flag is active in the command string, add the CSS class 'active-flag' to the `.flag-item` element.
6. If the flag is not active, remove the 'active-flag' class from the `.flag-item` element.

Output ONLY the JavaScript code. No markdown formatting, no explanation. Just the raw JS.
"""

    data = {
        "model": "Qwen3-Coder-Next-UD-Q4_K_M.gguf",
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0.1
    }

    req = urllib.request.Request(
        "http://192.168.8.1:8080/v1/chat/completions",
        data=json.dumps(data).encode('utf-8'),
        headers={'Content-Type': 'application/json'}
    )

    print("Sending request to local llama-server...")
    try:
        with urllib.request.urlopen(req) as response:
            result = json.loads(response.read().decode('utf-8'))
            content = result['choices'][0]['message']['content'].strip()
            
            # Remove any markdown formatting if present
            if content.startswith("```javascript"):
                content = content[13:]
            if content.startswith("```js"):
                content = content[5:]
            if content.startswith("```"):
                content = content[3:]
            if content.endswith("```"):
                content = content[:-3]
                
            content = content.strip()
            
            with open("src/highlight_logic.js", "w") as f:
                f.write(content)
            print("Successfully generated src/highlight_logic.js")
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    generate()

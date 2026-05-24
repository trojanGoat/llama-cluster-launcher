import json
import urllib.request
import urllib.parse
import sys

def parse():
    with open("docs/llama-help.txt", "r") as f:
        help_text = f.read()

    # Create the prompt
    prompt = """
You are an expert developer. Below is the output of `llama-server --help`.
Your task is to parse all the flags and their descriptions from this text.
Return ONLY a valid JSON array of objects, where each object has:
- "flag": The flag string, e.g. "-m, --model FNAME"
- "description": A concise description of what the flag does, based on the help text.

Output ONLY the JSON array, with no markdown block formatting, no markdown tags, and no other text.

Help text:
""" + help_text

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
            if content.startswith("```json"):
                content = content[7:]
            if content.startswith("```"):
                content = content[3:]
            if content.endswith("```"):
                content = content[:-3]
                
            content = content.strip()
            
            # Write to a file
            with open("docs/llama-flags.json", "w") as f:
                f.write(content)
            print("Successfully parsed flags into docs/llama-flags.json")
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    parse()

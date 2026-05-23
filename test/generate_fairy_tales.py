import json
import urllib.request
import urllib.error
import os

url = "http://localhost:8080/v1/chat/completions"
headers = {"Content-Type": "application/json"}

prompt = """Write 5 different short fairy tales for kids. 
Separate each fairy tale with the exact string "---FAIRYTALE_DELIMITER---" on its own line.
Do not add any other text before or after the fairy tales."""

data = {
    "model": "qwen3.5",
    "messages": [
        {"role": "system", "content": "You are a helpful storytelling assistant."},
        {"role": "user", "content": prompt}
    ],
    "temperature": 0.7,
    "max_tokens": 5000
}

req = urllib.request.Request(url, data=json.dumps(data).encode("utf-8"), headers=headers, method="POST")

try:
    print("Sending request to local llama-server cluster...")
    with urllib.request.urlopen(req) as response:
        result = json.loads(response.read().decode("utf-8"))
        
        content = result["choices"][0]["message"]["content"]
        
        # Split by delimiter
        tales = content.split("---FAIRYTALE_DELIMITER---")
        tales = [t.strip() for t in tales if t.strip()]
        
        output_dir = os.path.join(os.path.dirname(__file__), "fairy_tales")
        os.makedirs(output_dir, exist_ok=True)
        
        for i, tale in enumerate(tales):
            file_path = os.path.join(output_dir, f"fairy_tale_{i+1}.txt")
            with open(file_path, "w", encoding="utf-8") as f:
                f.write(tale)
            print(f"Saved: {file_path}")
            
except urllib.error.URLError as e:
    print(f"Error connecting to cluster: {e.reason}")
except Exception as e:
    print(f"An error occurred: {e}")

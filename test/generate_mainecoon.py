import json
import urllib.request
import urllib.error
import os

url = "http://localhost:8080/v1/chat/completions"
headers = {"Content-Type": "application/json"}

prompt = """Please write a comprehensive guide and a few accompanying articles about Maine Coon behavior from 5 months old up to 1 year of age. 
Detail what behaviors, personality changes, and growth milestones to expect during this "teenage" phase of a Maine Coon kitten's life. 
Structure it as a main guide followed by a few short articles."""

data = {
    "model": "qwen3.5",
    "messages": [
        {"role": "system", "content": "You are an expert feline behaviorist and writer."},
        {"role": "user", "content": prompt}
    ],
    "temperature": 0.7,
    "max_tokens": 4000
}

req = urllib.request.Request(url, data=json.dumps(data).encode("utf-8"), headers=headers, method="POST")

try:
    print("Sending request to local llama-server cluster...")
    with urllib.request.urlopen(req) as response:
        result = json.loads(response.read().decode("utf-8"))
        
        content = result["choices"][0]["message"]["content"]
        
        output_dir = os.path.join(os.path.dirname(__file__), "mainecoon_articles")
        os.makedirs(output_dir, exist_ok=True)
        
        file_path = os.path.join(output_dir, "mainecoon_behavior_guide.txt")
        with open(file_path, "w", encoding="utf-8") as f:
            f.write(content)
            
        print(f"Success! Response saved to {file_path}")
            
except urllib.error.URLError as e:
    print(f"Error connecting to cluster: {e.reason}")
except Exception as e:
    print(f"An error occurred: {e}")

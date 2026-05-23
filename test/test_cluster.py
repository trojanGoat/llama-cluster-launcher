import urllib.request
import json
import os

url = "http://127.0.0.1:8080/v1/chat/completions"
headers = {
    "Content-Type": "application/json"
}

data = {
    "model": "qwen3.5", # The actual name doesn't matter much for llama.cpp, it ignores it usually
    "messages": [
        {"role": "system", "content": "You are a helpful coding assistant."},
        {"role": "user", "content": "Please write a comprehensive, highly detailed 10,000-word book on the history of Artificial Intelligence. Include 20 chapters, going deep into early neural networks, backpropagation, the AI winters, the rise of deep learning, transformer architectures, and the future of AGI. Do not summarize; write the full text of the book."}
    ],
    "temperature": 0.7,
    "max_tokens": 5000
}

req = urllib.request.Request(url, data=json.dumps(data).encode("utf-8"), headers=headers, method="POST")

print("Sending request to local llama-server cluster...")

try:
    with urllib.request.urlopen(req) as response:
        result = json.loads(response.read().decode("utf-8"))
        
        reply = result['choices'][0]['message']['content']
        
        output_path = os.path.join(os.path.dirname(__file__), "cluster_output.txt")
        with open(output_path, "w") as f:
            f.write("--- Request ---\n")
            f.write(data["messages"][1]["content"] + "\n\n")
            f.write("--- Response ---\n")
            f.write(reply)
            
        print(f"Success! Response saved to {output_path}")
        print("\nModel said:")
        print(reply)
        
except Exception as e:
    print(f"Error connecting to cluster: {e}")

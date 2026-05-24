import json
import urllib.request
import os

URL = "http://192.168.8.1:8080/v1/chat/completions"
MODEL = "Qwen3-Coder-Next-UD-Q4_K_M.gguf"

def query_llama(prompt, system="You are an expert web developer."):
    data = {
        "model": MODEL,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": prompt}
        ],
        "temperature": 0.2
    }
    req = urllib.request.Request(
        URL,
        data=json.dumps(data).encode('utf-8'),
        headers={'Content-Type': 'application/json'}
    )
    with urllib.request.urlopen(req) as response:
        result = json.loads(response.read().decode('utf-8'))
        content = result['choices'][0]['message']['content'].strip()
        
        # Clean up markdown
        if content.startswith("```"):
            lines = content.split('\n')
            if lines[0].startswith("```"):
                lines = lines[1:]
            if lines[-1].startswith("```"):
                lines = lines[:-1]
            content = '\n'.join(lines)
        return content

def main():
    print("Generating HTML content (Chunk 1)...")
    html_prompt = """
Write the HTML content for an 'About' modal for the app "Llama Cluster Launcher".
The HTML should NOT include `<html>`, `<body>`, or `<style>` tags. Just the HTML structure for the modal overlay and the modal itself.
The modal should have `id="aboutModal"` and an overlay with `id="aboutModalOverlay"`.
It must include:
- A close button with `id="closeAboutModal"`.
- An image tag pointing to `logos/llama_cluster_logo_v001.png` with a class to shrink it by 50% (e.g. `class="about-logo"`).
- A quick summary of the app (it's a GUI launcher for llama.cpp clustered inference with a master and SSH slaves).
- A step-by-step 'Getting Started' guide.
- The version `v1.0.0`.
- A link to the GitHub repo `https://github.com/JorgeRazon/llama-cluster-launcher`.

Output ONLY the HTML.
"""
    html_content = query_llama(html_prompt)
    with open("src/about_generated.html", "w") as f:
        f.write(html_content)

    print("Generating CSS styles (Chunk 2)...")
    css_prompt = """
Write the CSS styles for the 'About' modal you just created for a dark-mode Electron app.
The elements used in the HTML include: `#aboutModalOverlay`, `#aboutModal`, `#closeAboutModal`, `.about-logo`, and other semantic elements for the summary and getting started guide.
Make it elegant, centered, with a dark background.
The `.about-logo` MUST be styled with a width of 50%.
Output ONLY valid CSS, no HTML, no markdown.
"""
    css_content = query_llama(css_prompt)
    with open("src/about_generated.css", "w") as f:
        f.write(css_content)
        
    print("Finished generating content.")

if __name__ == "__main__":
    main()

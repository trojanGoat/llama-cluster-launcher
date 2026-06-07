const path = require('path')
module.exports = {
  version: "1.0",
  title: "Llama Cluster Launcher",
  description: "GUI launcher for llama.cpp clustered inference",
  icon: "src/logos/llama_cluster_logo_v001.png",
  menu: async (kernel) => {
    let installed = await kernel.exists(__dirname, "node_modules")
    if (installed) {
      return [{
        icon: "fa-solid fa-power-off",
        text: "Start",
        href: "start.json",
      }, {
        icon: "fa-solid fa-arrows-rotate",
        text: "Update",
        href: "update.json",
      }, {
        icon: "fa-solid fa-plug",
        text: "Install",
        href: "install.json",
      }]
    } else {
      return [{
        icon: "fa-solid fa-plug",
        text: "Install",
        href: "install.json"
      }]
    }
  }
}

function highlightActiveFlags(commandString) {
  const flagItems = document.querySelectorAll('#flagsModalBody .flag-item');
  const tokens = commandString.split(/\s+/);
  
  flagItems.forEach(item => {
    const flagNameElement = item.querySelector('.flag-name');
    if (!flagNameElement) return;
    
    const flagNameText = flagNameElement.textContent;
    // Extract flag names: short flags like -m and long flags like --model
    const flagMatches = flagNameText.match(/(-\w+|--[\w-]+)/g);
    
    if (flagMatches) {
      // Check if any of the extracted flags exist in the command tokens
      const isActive = flagMatches.some(flag => tokens.includes(flag));
      if (isActive) {
        item.classList.add('active-flag');
      } else {
        item.classList.remove('active-flag');
      }
    } else {
      item.classList.remove('active-flag');
    }
  });
}
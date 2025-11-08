// content.js

function injectScript(file) {
  const script = document.createElement('script');
  script.src = chrome.runtime.getURL(file);
  script.onload = function () {
    this.remove();
  };
  (document.head || document.documentElement).appendChild(script);
}

// Vänta tills sidan laddats ordentligt
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => injectScript('injected.js'));
} else {
  injectScript('injected.js');
}

(() => {
  const params = new URLSearchParams(window.location.search);
  const theme = params.get("theme");
  if (theme === "dark" || theme === "light") {
    document.documentElement.dataset.theme = theme;
  }
  if (params.get("embedded") === "true") {
    document.documentElement.dataset.embedded = "true";
  }
})();

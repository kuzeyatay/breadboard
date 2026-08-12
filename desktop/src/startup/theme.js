(() => {
  const theme = new URLSearchParams(window.location.search).get("theme");
  if (theme === "dark" || theme === "light") {
    document.documentElement.dataset.theme = theme;
  }
})();

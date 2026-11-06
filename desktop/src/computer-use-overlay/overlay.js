const params = new URLSearchParams(window.location.search);
const surface = "edge";
const appearance = params.get("appearance") === "red" ? "red" : "green";
document.documentElement.dataset.surface = surface;
document.documentElement.dataset.banner = params.get("banner") === "true" ? "true" : "false";
document.documentElement.dataset.appearance = appearance;

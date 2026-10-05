import "./popup.css";

const status = document.querySelector<HTMLParagraphElement>("#status");
if (status) {
  status.textContent = "Project scaffold ready. Audio capture and captions are not implemented yet.";
}

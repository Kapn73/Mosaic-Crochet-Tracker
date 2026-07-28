(() => {
  "use strict";

  if (!("serviceWorker" in navigator)) return;

  window.addEventListener("load", async () => {
    try {
      const registration = await navigator.serviceWorker.register(
        "./service-worker.js",
        { scope: "./" }
      );

      if (registration.waiting) {
        window.dispatchEvent(
          new CustomEvent("mosaic-pwa-update", {
            detail: { registration }
          })
        );
      }

      registration.addEventListener("updatefound", () => {
        const worker = registration.installing;
        if (!worker) return;

        worker.addEventListener("statechange", () => {
          if (
            worker.state === "installed" &&
            navigator.serviceWorker.controller
          ) {
            window.dispatchEvent(
              new CustomEvent("mosaic-pwa-update", {
                detail: { registration }
              })
            );
          }
        });
      });
    } catch (error) {
      console.warn("Offline app support could not be registered.", error);
    }
  });

  window.addEventListener("mosaic-pwa-update", (event) => {
    const registration = event.detail?.registration;
    if (!registration?.waiting) return;
    if (document.querySelector(".pwa-update-banner")) return;

    const banner = document.createElement("div");
    banner.className = "pwa-update-banner";
    banner.setAttribute("role", "status");

    const message = document.createElement("span");
    message.textContent = "A new viewer version is ready.";

    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Update";
    button.addEventListener("click", () => {
      registration.waiting.postMessage("SKIP_WAITING");
    });

    banner.append(message, button);
    document.body.appendChild(banner);
  });

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    window.location.reload();
  });
})();

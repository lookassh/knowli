import type { MetadataRoute } from "next";

/**
 * Manifest PWA (plan zadania 9). Aplikacja celowo NIE rejestruje service
 * workera: nie cache'uje prywatnych API i nie obiecuje nauki offline —
 * utrata sieci zamyka oceniane próby zamiast tworzyć lokalny wynik.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Umiem!",
    short_name: "Umiem!",
    description: "Krótkie sesje nauki dla dziecka",
    lang: "pl-PL",
    start_url: "/learn",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f6f6fb",
    theme_color: "#3b5bdb",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}

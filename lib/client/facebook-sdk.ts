"use client";

// FB JS SDK global — loaded dynamically for the WhatsApp Embedded Signup popup.
declare global {
  interface Window {
    FB?: {
      init: (params: object) => void;
      login: (
        callback: (response: { authResponse?: { code?: string } | null; status?: string }) => void,
        params: object,
      ) => void;
    };
    fbAsyncInit?: () => void;
  }
}

export function loadFbSdk(appId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.FB) {
      window.FB.init({ appId, autoLogAppEvents: true, xfbml: false, version: "v24.0" });
      resolve();
      return;
    }
    const timer = setTimeout(() => reject(new Error("FB SDK load timeout")), 15_000);
    window.fbAsyncInit = () => {
      clearTimeout(timer);
      window.FB!.init({ appId, autoLogAppEvents: true, xfbml: false, version: "v24.0" });
      resolve();
    };
    const script = document.createElement("script");
    script.src = "https://connect.facebook.net/pt_BR/sdk.js";
    script.async = true;
    script.defer = true;
    script.onerror = () => {
      clearTimeout(timer);
      reject(new Error("FB SDK failed to load"));
    };
    document.head.appendChild(script);
  });
}

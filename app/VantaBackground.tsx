"use client";

import { ReactNode, useEffect, useRef } from "react";

type VantaEffect = {
  destroy: () => void;
  resize?: () => void;
};

type VantaHaloOptions = {
  el: HTMLElement;
  THREE: unknown;
  mouseControls: boolean;
  touchControls: boolean;
  gyroControls: boolean;
  minHeight: number;
  minWidth: number;
  baseColor: number;
  backgroundColor: number;
  amplitudeFactor: number;
  xOffset: number;
  yOffset: number;
  size: number;
};

type VantaWindow = Window & {
  THREE?: unknown;
  VANTA?: {
    HALO?: (options: VantaHaloOptions) => VantaEffect;
  };
};

export function VantaBackground({ children }: { children: ReactNode }) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let effect: VantaEffect | null = null;
    let isMounted = true;

    async function initVanta() {
      await loadScript("/vendor/three.r134.min.js");
      await loadScript("/vendor/vanta.halo.min.js");

      if (!isMounted || !containerRef.current) {
        return;
      }

      const vantaWindow = window as VantaWindow;
      const halo = vantaWindow.VANTA?.HALO;

      if (!halo || !vantaWindow.THREE) {
        throw new Error("Vanta HALO script did not expose window.VANTA.HALO");
      }

      effect = halo({
        el: containerRef.current,
        THREE: vantaWindow.THREE,
        mouseControls: true,
        touchControls: true,
        gyroControls: false,
        minHeight: 200,
        minWidth: 200,
        backgroundColor: 0x131a43,
        baseColor: 0x001a59,
        size: 1,
        amplitudeFactor: 1,
        xOffset: 0,
        yOffset: 0,
      });
    }

    initVanta().catch((error) => {
      console.error("Failed to initialize Vanta HALO", error);
    });

    return () => {
      isMounted = false;
      effect?.destroy();
    };
  }, []);

  return (
    <div ref={containerRef} className="vanta-stage">
      <div className="vanta-overlay" />
      <div className="vanta-content">{children}</div>
    </div>
  );
}

function loadScript(src: string) {
  return new Promise<void>((resolve, reject) => {
    const existingScript = document.querySelector<HTMLScriptElement>(
      `script[src="${src}"]`,
    );

    if (existingScript?.dataset.loaded === "true") {
      resolve();
      return;
    }

    const script = existingScript || document.createElement("script");

    script.addEventListener(
      "load",
      () => {
        script.dataset.loaded = "true";
        resolve();
      },
      { once: true },
    );
    script.addEventListener("error", () => reject(new Error(src)), {
      once: true,
    });

    if (!existingScript) {
      script.src = src;
      script.async = true;
      document.body.appendChild(script);
    }
  });
}

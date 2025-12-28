/**
 * Modern Fullscreen API utility
 * Uses the standard Fullscreen API (https://developer.mozilla.org/en-US/docs/Web/API/Fullscreen_API)
 */

export class FullscreenApi {
    /**
     * Check if fullscreen is supported
     */
    public static isSupported(): boolean {
        return !!(
            document.fullscreenEnabled ||
            (document as any).webkitFullscreenEnabled ||
            (document as any).mozFullScreenEnabled ||
            (document as any).msFullscreenEnabled
        );
    }

    /**
     * Check if currently in fullscreen mode
     */
    public static isFullscreen(): boolean {
        return !!(
            document.fullscreenElement ||
            (document as any).webkitFullscreenElement ||
            (document as any).mozFullScreenElement ||
            (document as any).msFullscreenElement
        );
    }

    /**
     * Get the current fullscreen element
     */
    public static getFullscreenElement(): Element | null {
        return (
            document.fullscreenElement ||
            (document as any).webkitFullscreenElement ||
            (document as any).mozFullScreenElement ||
            (document as any).msFullscreenElement ||
            null
        );
    }

    /**
     * Request fullscreen for an element using the modern Fullscreen API
     */
    public static async requestFullscreen(element: HTMLElement): Promise<void> {
        if (element.requestFullscreen) {
            return element.requestFullscreen();
        } else if ((element as any).webkitRequestFullscreen) {
            return (element as any).webkitRequestFullscreen();
        } else if ((element as any).mozRequestFullScreen) {
            return (element as any).mozRequestFullScreen();
        } else if ((element as any).msRequestFullscreen) {
            return (element as any).msRequestFullscreen();
        }
        throw new Error('Fullscreen API is not supported');
    }

    /**
     * Exit fullscreen mode
     */
    public static async exitFullscreen(): Promise<void> {
        if (document.exitFullscreen) {
            return document.exitFullscreen();
        } else if ((document as any).webkitExitFullscreen) {
            return (document as any).webkitExitFullscreen();
        } else if ((document as any).mozCancelFullScreen) {
            return (document as any).mozCancelFullScreen();
        } else if ((document as any).msExitFullscreen) {
            return (document as any).msExitFullscreen();
        }
        throw new Error('Fullscreen API is not supported');
    }

    /**
     * Toggle fullscreen for an element
     */
    public static async toggleFullscreen(element: HTMLElement): Promise<void> {
        if (this.isFullscreen()) {
            return this.exitFullscreen();
        } else {
            return this.requestFullscreen(element);
        }
    }

    /**
     * Add a fullscreen change event listener
     */
    public static addFullscreenChangeListener(callback: (isFullscreen: boolean) => void): () => void {
        const handler = () => callback(this.isFullscreen());

        document.addEventListener('fullscreenchange', handler);
        document.addEventListener('webkitfullscreenchange', handler);
        document.addEventListener('mozfullscreenchange', handler);
        document.addEventListener('MSFullscreenChange', handler);

        // Return cleanup function
        return () => {
            document.removeEventListener('fullscreenchange', handler);
            document.removeEventListener('webkitfullscreenchange', handler);
            document.removeEventListener('mozfullscreenchange', handler);
            document.removeEventListener('MSFullscreenChange', handler);
        };
    }

    /**
     * Add a fullscreen error event listener
     */
    public static addFullscreenErrorListener(callback: (error: Event) => void): () => void {
        document.addEventListener('fullscreenerror', callback);
        document.addEventListener('webkitfullscreenerror', callback);
        document.addEventListener('mozfullscreenerror', callback);
        document.addEventListener('MSFullscreenError', callback);

        // Return cleanup function
        return () => {
            document.removeEventListener('fullscreenerror', callback);
            document.removeEventListener('webkitfullscreenerror', callback);
            document.removeEventListener('mozfullscreenerror', callback);
            document.removeEventListener('MSFullscreenError', callback);
        };
    }
}

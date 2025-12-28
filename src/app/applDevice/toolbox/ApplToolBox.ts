import { ToolBox } from '../../toolbox/ToolBox';
import SvgImage from '../../ui/SvgImage';
import { BasePlayer } from '../../player/BasePlayer';
import { ToolBoxButton } from '../../toolbox/ToolBoxButton';
import { ToolBoxElement } from '../../toolbox/ToolBoxElement';
import { ToolBoxCheckbox } from '../../toolbox/ToolBoxCheckbox';
import { WdaProxyClient } from '../client/WdaProxyClient';
import { FullscreenApi } from '../../ui/FullscreenApi';

const BUTTONS = [
    {
        title: 'Home',
        name: 'home',
        icon: SvgImage.Icon.HOME,
    },
];

export interface StreamClient {
    getDeviceName(): string;
}

export class ApplToolBox extends ToolBox {
    protected constructor(list: ToolBoxElement<any>[]) {
        super(list);
    }

    public static createToolBox(
        udid: string,
        player: BasePlayer,
        client: StreamClient,
        wdaConnection: WdaProxyClient,
        moreBox?: HTMLElement,
    ): ApplToolBox {
        const playerName = player.getName();
        const list = BUTTONS.slice();
        const handler = <K extends keyof HTMLElementEventMap, T extends HTMLElement>(
            _: K,
            element: ToolBoxElement<T>,
        ) => {
            if (!element.optional?.name) {
                return;
            }
            const { name } = element.optional;
            wdaConnection.pressButton(name);
        };
        const elements: ToolBoxElement<any>[] = list.map((item) => {
            const button = new ToolBoxButton(item.title, item.icon, {
                name: item.name,
            });
            button.addEventListener('click', handler);
            return button;
        });
        if (player.supportsScreenshot) {
            const screenshot = new ToolBoxButton('Take screenshot', SvgImage.Icon.CAMERA);
            screenshot.addEventListener('click', () => {
                player.createScreenshot(client.getDeviceName());
            });
            elements.push(screenshot);
        }

        // Add fullscreen button using modern Fullscreen API
        if (FullscreenApi.isSupported()) {
            const fullscreenBtn = new ToolBoxButton('Toggle fullscreen', SvgImage.Icon.FULLSCREEN);
            const updateFullscreenIcon = (isFullscreen: boolean): void => {
                const svgElements = fullscreenBtn.getAllElements();
                svgElements.forEach((el) => {
                    const svg = el.querySelector('svg');
                    if (svg) {
                        const newIcon = SvgImage.create(
                            isFullscreen ? SvgImage.Icon.FULLSCREEN_EXIT : SvgImage.Icon.FULLSCREEN,
                        );
                        svg.replaceWith(newIcon);
                    }
                });
            };

            FullscreenApi.addFullscreenChangeListener(updateFullscreenIcon);

            fullscreenBtn.addEventListener('click', () => {
                const deviceView = player.getTouchableElement().closest('.device-view');
                if (deviceView instanceof HTMLElement) {
                    FullscreenApi.toggleFullscreen(deviceView).catch((err) => {
                        console.error('Failed to toggle fullscreen:', err);
                    });
                }
            });
            elements.push(fullscreenBtn);
        }

        if (moreBox) {
            const more = new ToolBoxCheckbox('More', SvgImage.Icon.MORE, `show_more_${udid}_${playerName}`);
            more.addEventListener('click', (_, el) => {
                const element = el.getElement();
                moreBox.style.display = element.checked ? 'block' : 'none';
            });
            elements.unshift(more);
        }
        return new ApplToolBox(elements);
    }
}

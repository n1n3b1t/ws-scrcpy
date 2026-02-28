import { ToolBox } from '../../toolbox/ToolBox';
import KeyEvent from '../android/KeyEvent';
import SvgImage from '../../ui/SvgImage';
import { KeyCodeControlMessage } from '../../controlMessage/KeyCodeControlMessage';
import { ToolBoxButton } from '../../toolbox/ToolBoxButton';
import { ToolBoxElement } from '../../toolbox/ToolBoxElement';
import { ToolBoxCheckbox } from '../../toolbox/ToolBoxCheckbox';
import { StreamClientScrcpy } from '../client/StreamClientScrcpy';
import { BasePlayer } from '../../player/BasePlayer';
import { FullscreenApi } from '../../ui/FullscreenApi';

// Standard Android developer environment controls
const BUTTONS = [
    {
        title: 'Back',
        code: KeyEvent.KEYCODE_BACK,
        icon: SvgImage.Icon.BACK,
    },
    {
        title: 'Home',
        code: KeyEvent.KEYCODE_HOME,
        icon: SvgImage.Icon.HOME,
    },
    {
        title: 'Overview',
        code: KeyEvent.KEYCODE_APP_SWITCH,
        icon: SvgImage.Icon.OVERVIEW,
    },
    {
        title: 'Volume up',
        code: KeyEvent.KEYCODE_VOLUME_UP,
        icon: SvgImage.Icon.VOLUME_UP,
    },
    {
        title: 'Volume down',
        code: KeyEvent.KEYCODE_VOLUME_DOWN,
        icon: SvgImage.Icon.VOLUME_DOWN,
    },
    {
        title: 'Power',
        code: KeyEvent.KEYCODE_POWER,
        icon: SvgImage.Icon.POWER,
    },
];

export class GoogToolBox extends ToolBox {
    protected constructor(list: ToolBoxElement<any>[]) {
        super(list);
    }

    public static createToolBox(udid: string, player: BasePlayer, client: StreamClientScrcpy): GoogToolBox {
        const playerName = player.getName();
        const handler = <K extends keyof HTMLElementEventMap, T extends HTMLElement>(
            type: K,
            element: ToolBoxElement<T>,
        ) => {
            if (!element.optional?.code) {
                return;
            }
            const { code } = element.optional;
            const action = type === 'mousedown' ? KeyEvent.ACTION_DOWN : KeyEvent.ACTION_UP;
            const event = new KeyCodeControlMessage(action, code, 0, 0);
            client.sendMessage(event);
        };
        const elements: ToolBoxElement<any>[] = BUTTONS.map((item) => {
            const button = new ToolBoxButton(item.title, item.icon, {
                code: item.code,
            });
            button.addEventListener('mousedown', handler);
            button.addEventListener('mouseup', handler);
            return button;
        });

        if (player.supportsScreenshot) {
            const screenshot = new ToolBoxButton('Take screenshot', SvgImage.Icon.CAMERA);
            screenshot.addEventListener('click', () => {
                player.createScreenshot(client.getDeviceName());
            });
            elements.push(screenshot);
        }

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
                const phoneFrame = player.getTouchableElement().closest('.phone-frame');
                if (phoneFrame instanceof HTMLElement) {
                    FullscreenApi.toggleFullscreen(phoneFrame).catch((err) => {
                        console.error('Failed to toggle fullscreen:', err);
                    });
                }
            });
            elements.push(fullscreenBtn);
        }

        const keyboard = new ToolBoxCheckbox(
            'Capture keyboard',
            SvgImage.Icon.KEYBOARD,
            `capture_keyboard_${udid}_${playerName}`,
        );
        keyboard.addEventListener('click', (_, el) => {
            const element = el.getElement();
            client.setHandleKeyboardEvents(element.checked);
        });
        elements.push(keyboard);

        return new GoogToolBox(elements);
    }
}

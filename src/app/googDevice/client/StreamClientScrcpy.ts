import { BaseClient } from '../../client/BaseClient';
import KeyEvent from '../android/KeyEvent';
import { ParamsStreamScrcpy } from '../../../types/ParamsStreamScrcpy';
import { GoogToolBox } from '../toolbox/GoogToolBox';
import VideoSettings from '../../VideoSettings';
import Size from '../../Size';
import { ControlMessage } from '../../controlMessage/ControlMessage';
import { ClientsStats, DisplayCombinedInfo } from '../../client/StreamReceiver';
import { CommandControlMessage } from '../../controlMessage/CommandControlMessage';
import Util from '../../Util';
import { KeyEventListener, KeyInputHandler } from '../KeyInputHandler';
import { KeyCodeControlMessage } from '../../controlMessage/KeyCodeControlMessage';
import { BasePlayer, PlayerClass } from '../../player/BasePlayer';
import GoogDeviceDescriptor from '../../../types/GoogDeviceDescriptor';
import {
    FeaturedInteractionHandler,
    InteractionHandlerListener,
} from '../../interactionHandler/FeaturedInteractionHandler';
import DeviceMessage from '../DeviceMessage';
import { DisplayInfo } from '../../DisplayInfo';
import { ACTION } from '../../../common/Action';
import { StreamReceiverScrcpy } from './StreamReceiverScrcpy';
import { ParamsDeviceTracker } from '../../../types/ParamsDeviceTracker';

type StartParams = {
    udid: string;
    playerName?: string;
    player?: BasePlayer;
    fitToScreen?: boolean;
    videoSettings?: VideoSettings;
};

const TAG = '[StreamClientScrcpy]';

export class StreamClientScrcpy
    extends BaseClient<ParamsStreamScrcpy, never>
    implements KeyEventListener, InteractionHandlerListener
{
    public static ACTION = 'stream';
    private static players: Map<string, PlayerClass> = new Map<string, PlayerClass>();

    private controlButtons?: HTMLElement;
    private deviceName = '';
    private clientId = -1;
    private clientsCount = -1;
    private joinedStream = false;
    private requestedVideoSettings?: VideoSettings;
    private touchHandler?: FeaturedInteractionHandler;
    private player?: BasePlayer;
    private fitToScreen?: boolean;
    private readonly streamReceiver: StreamReceiverScrcpy;

    public static registerPlayer(playerClass: PlayerClass): void {
        if (playerClass.isSupported()) {
            this.players.set(playerClass.playerFullName, playerClass);
        }
    }

    public static getPlayers(): PlayerClass[] {
        return Array.from(this.players.values());
    }

    private static getPlayerClass(playerName: string): PlayerClass | undefined {
        let playerClass: PlayerClass | undefined;
        for (const value of StreamClientScrcpy.players.values()) {
            if (value.playerFullName === playerName || value.playerCodeName === playerName) {
                playerClass = value;
            }
        }
        return playerClass;
    }

    public static createPlayer(playerName: string, udid: string, displayInfo?: DisplayInfo): BasePlayer | undefined {
        const playerClass = this.getPlayerClass(playerName);
        if (!playerClass) {
            return;
        }
        return new playerClass(udid, displayInfo);
    }

    public static getFitToScreen(playerName: string, udid: string, displayInfo?: DisplayInfo): boolean {
        const playerClass = this.getPlayerClass(playerName);
        if (!playerClass) {
            return false;
        }
        return playerClass.getFitToScreenStatus(udid, displayInfo);
    }

    public static start(
        query: URLSearchParams | ParamsStreamScrcpy,
        streamReceiver?: StreamReceiverScrcpy,
        player?: BasePlayer,
        fitToScreen?: boolean,
        videoSettings?: VideoSettings,
    ): StreamClientScrcpy {
        if (query instanceof URLSearchParams) {
            const params = StreamClientScrcpy.parseParameters(query);
            return new StreamClientScrcpy(params, streamReceiver, player, fitToScreen, videoSettings);
        } else {
            return new StreamClientScrcpy(query, streamReceiver, player, fitToScreen, videoSettings);
        }
    }

    private static createVideoSettingsWithBounds(old: VideoSettings, newBounds: Size): VideoSettings {
        return new VideoSettings({
            crop: old.crop,
            bitrate: old.bitrate,
            bounds: newBounds,
            maxFps: old.maxFps,
            iFrameInterval: old.iFrameInterval,
            sendFrameMeta: old.sendFrameMeta,
            lockedVideoOrientation: old.lockedVideoOrientation,
            displayId: old.displayId,
            codecOptions: old.codecOptions,
            encoderName: old.encoderName,
        });
    }

    protected constructor(
        params: ParamsStreamScrcpy,
        streamReceiver?: StreamReceiverScrcpy,
        player?: BasePlayer,
        fitToScreen?: boolean,
        videoSettings?: VideoSettings,
    ) {
        super(params);
        if (streamReceiver) {
            this.streamReceiver = streamReceiver;
        } else {
            this.streamReceiver = new StreamReceiverScrcpy(this.params);
        }

        const { udid, player: playerName } = this.params;
        this.startStream({ udid, player, playerName, fitToScreen, videoSettings });
        this.setBodyClass('stream');
    }

    public static parseParameters(params: URLSearchParams): ParamsStreamScrcpy {
        const typedParams = super.parseParameters(params);
        const { action } = typedParams;
        if (action !== ACTION.STREAM_SCRCPY) {
            throw Error('Incorrect action');
        }
        return {
            ...typedParams,
            action,
            player: Util.parseString(params, 'player', true),
            udid: Util.parseString(params, 'udid', true),
            ws: Util.parseString(params, 'ws', true),
        };
    }

    public OnDeviceMessage = (message: DeviceMessage): void => {
        // No-op — GoogMoreBox removed
        void message;
    };

    public onVideo = (data: ArrayBuffer): void => {
        if (!this.player) {
            return;
        }
        const STATE = BasePlayer.STATE;
        if (this.player.getState() === STATE.PAUSED) {
            this.player.play();
        }
        if (this.player.getState() === STATE.PLAYING) {
            this.player.pushFrame(new Uint8Array(data));
        }
    };

    public onClientsStats = (stats: ClientsStats): void => {
        this.deviceName = stats.deviceName;
        this.clientId = stats.clientId;
        this.setTitle(`Stream ${this.deviceName}`);
        // Notify parent iframe that stream is ready (first clients stats = connected)
        if (window.self !== window.top) {
            window.parent.postMessage({ type: 'STREAM_READY' }, '*');
        }
    };

    public onDisplayInfo = (infoArray: DisplayCombinedInfo[]): void => {
        if (!this.player) {
            return;
        }
        let currentSettings = this.player.getVideoSettings();
        const displayId = currentSettings.displayId;
        const info = infoArray.find((value) => {
            return value.displayInfo.displayId === displayId;
        });
        if (!info) {
            return;
        }
        if (this.player.getState() === BasePlayer.STATE.PAUSED) {
            this.player.play();
        }
        const { videoSettings, screenInfo } = info;
        this.player.setDisplayInfo(info.displayInfo);
        if (typeof this.fitToScreen !== 'boolean') {
            this.fitToScreen = this.player.getFitToScreenStatus();
        }
        if (this.fitToScreen) {
            const newBounds = this.getMaxSize();
            if (newBounds) {
                currentSettings = StreamClientScrcpy.createVideoSettingsWithBounds(currentSettings, newBounds);
                this.player.setVideoSettings(currentSettings, this.fitToScreen, false);
            }
        }
        if (!videoSettings || !screenInfo) {
            this.joinedStream = true;
            this.sendMessage(CommandControlMessage.createSetVideoSettingsCommand(currentSettings));
            return;
        }

        this.clientsCount = info.connectionCount;
        let min = VideoSettings.copy(videoSettings);
        const oldInfo = this.player.getScreenInfo();
        if (!screenInfo.equals(oldInfo)) {
            this.player.setScreenInfo(screenInfo);
        }

        if (!videoSettings.equals(currentSettings)) {
            this.applyNewVideoSettings(videoSettings, videoSettings.equals(this.requestedVideoSettings));
        }
        if (!oldInfo) {
            const bounds = currentSettings.bounds;
            const videoSize: Size = screenInfo.videoSize;
            const onlyOneClient = this.clientsCount === 0;
            const smallerThenCurrent = bounds && (bounds.width < videoSize.width || bounds.height < videoSize.height);
            if (onlyOneClient || smallerThenCurrent) {
                min = currentSettings;
            }
            const minBounds = currentSettings.bounds?.intersect(min.bounds);
            if (minBounds && !minBounds.equals(min.bounds)) {
                min = StreamClientScrcpy.createVideoSettingsWithBounds(min, minBounds);
            }
        }
        if (!min.equals(videoSettings) || !this.joinedStream) {
            this.joinedStream = true;
            this.sendMessage(CommandControlMessage.createSetVideoSettingsCommand(min));
        }
    };

    public onDisconnected = (): void => {
        this.streamReceiver.off('deviceMessage', this.OnDeviceMessage);
        this.streamReceiver.off('video', this.onVideo);
        this.streamReceiver.off('clientsStats', this.onClientsStats);
        this.streamReceiver.off('displayInfo', this.onDisplayInfo);
        this.streamReceiver.off('disconnected', this.onDisconnected);

        this.touchHandler?.release();
        this.touchHandler = undefined;

        // Notify parent iframe of error/disconnect
        if (window.self !== window.top) {
            window.parent.postMessage({ type: 'STREAM_ERROR', message: 'Stream disconnected' }, '*');
        }
    };

    public startStream({ udid, player, playerName, videoSettings, fitToScreen }: StartParams): void {
        if (!udid) {
            throw Error(`Invalid udid value: "${udid}"`);
        }

        this.fitToScreen = fitToScreen;
        if (!player) {
            if (typeof playerName !== 'string') {
                throw Error('Must provide BasePlayer instance or playerName');
            }
            let displayInfo: DisplayInfo | undefined;
            if (this.streamReceiver && videoSettings) {
                displayInfo = this.streamReceiver.getDisplayInfo(videoSettings.displayId);
            }
            const p = StreamClientScrcpy.createPlayer(playerName, udid, displayInfo);
            if (!p) {
                throw Error(`Unsupported player: "${playerName}"`);
            }
            if (typeof fitToScreen !== 'boolean') {
                fitToScreen = StreamClientScrcpy.getFitToScreen(playerName, udid, displayInfo);
            }
            player = p;
        }
        this.player = player;
        this.setTouchListeners(player);

        if (!videoSettings) {
            videoSettings = player.getVideoSettings();
        }

        // Build the phone frame structure
        const phoneWrapper = document.createElement('div');
        phoneWrapper.className = 'phone-wrapper';

        const phoneFrame = document.createElement('div');
        phoneFrame.className = 'phone-frame';

        const notch = document.createElement('div');
        notch.className = 'phone-notch';
        phoneFrame.appendChild(notch);

        const videoContainer = document.createElement('div');
        videoContainer.className = 'video';
        phoneFrame.appendChild(videoContainer);

        const googToolBox = GoogToolBox.createToolBox(udid, player, this);
        this.controlButtons = googToolBox.getHolderElement();
        this.controlButtons.className += ' controls-hud';

        phoneWrapper.appendChild(phoneFrame);
        phoneWrapper.appendChild(this.controlButtons);
        player.setParent(videoContainer);
        player.pause();

        document.body.appendChild(phoneWrapper);

        if (fitToScreen) {
            const newBounds = this.getMaxSize();
            if (newBounds) {
                videoSettings = StreamClientScrcpy.createVideoSettingsWithBounds(videoSettings, newBounds);
            }
        }
        this.applyNewVideoSettings(videoSettings, false);

        const streamReceiver = this.streamReceiver;
        streamReceiver.on('deviceMessage', this.OnDeviceMessage);
        streamReceiver.on('video', this.onVideo);
        streamReceiver.on('clientsStats', this.onClientsStats);
        streamReceiver.on('displayInfo', this.onDisplayInfo);
        streamReceiver.on('disconnected', this.onDisconnected);

        // Set up the postMessage bridge for Hive iframe control
        this.setupPostMessageBridge();

        console.log(TAG, player.getName(), udid);
    }

    public sendMessage(message: ControlMessage): void {
        this.streamReceiver.sendEvent(message);
    }

    public getDeviceName(): string {
        return this.deviceName;
    }

    public setHandleKeyboardEvents(enabled: boolean): void {
        if (enabled) {
            KeyInputHandler.addEventListener(this);
        } else {
            KeyInputHandler.removeEventListener(this);
        }
    }

    public onKeyEvent(event: KeyCodeControlMessage): void {
        this.sendMessage(event);
    }

    public sendNewVideoSetting(videoSettings: VideoSettings): void {
        this.requestedVideoSettings = videoSettings;
        this.sendMessage(CommandControlMessage.createSetVideoSettingsCommand(videoSettings));
    }

    public getClientId(): number {
        return this.clientId;
    }

    public getClientsCount(): number {
        return this.clientsCount;
    }

    public getMaxSize(): Size | undefined {
        if (!this.controlButtons) {
            return;
        }
        const body = document.body;
        const width = body.clientWidth & ~15;
        const height = body.clientHeight & ~15;
        return new Size(width, height);
    }

    private setTouchListeners(player: BasePlayer): void {
        if (this.touchHandler) {
            return;
        }
        this.touchHandler = new FeaturedInteractionHandler(player, this);
    }

    private applyNewVideoSettings(videoSettings: VideoSettings, saveToStorage: boolean): void {
        let fitToScreen = false;
        if (videoSettings.bounds && videoSettings.bounds.equals(this.getMaxSize())) {
            fitToScreen = true;
        }
        if (this.player) {
            this.player.setVideoSettings(videoSettings, fitToScreen, saveToStorage);
        }
    }

    // --- postMessage API bridge for Hive iframe ---
    private setupPostMessageBridge(): void {
        window.addEventListener('message', (event: MessageEvent) => {
            if (!event.data || typeof event.data.type !== 'string') {
                return;
            }
            this.handlePostMessage(event.data);
        });
    }

    private handlePostMessage(data: { type: string }): void {
        switch (data.type) {
            case 'KEYEVENT_HOME':
                this.sendKeyEvent(KeyEvent.KEYCODE_HOME);
                break;
            case 'KEYEVENT_BACK':
                this.sendKeyEvent(KeyEvent.KEYCODE_BACK);
                break;
            case 'KEYEVENT_RECENTS':
                this.sendKeyEvent(KeyEvent.KEYCODE_APP_SWITCH);
                break;
            case 'KEYEVENT_VOLUME_UP':
                this.sendKeyEvent(KeyEvent.KEYCODE_VOLUME_UP);
                break;
            case 'KEYEVENT_VOLUME_DOWN':
                this.sendKeyEvent(KeyEvent.KEYCODE_VOLUME_DOWN);
                break;
            case 'KEYEVENT_POWER':
                this.sendKeyEvent(KeyEvent.KEYCODE_POWER);
                break;
            case 'ROTATE': {
                const rotateMsg = new CommandControlMessage(ControlMessage.TYPE_ROTATE_DEVICE);
                this.sendMessage(rotateMsg);
                break;
            }
            case 'SCREENSHOT':
                if (this.player && this.player.supportsScreenshot) {
                    const dataUrl = this.player.getImageDataURL();
                    if (window.self !== window.top) {
                        window.parent.postMessage({ type: 'SCREENSHOT_DATA', data: dataUrl }, '*');
                    }
                }
                break;
            default:
                console.warn(TAG, `Unknown postMessage command: ${data.type}`);
        }
    }

    private sendKeyEvent(keyCode: number): void {
        const down = new KeyCodeControlMessage(KeyEvent.ACTION_DOWN, keyCode, 0, 0);
        const up = new KeyCodeControlMessage(KeyEvent.ACTION_UP, keyCode, 0, 0);
        this.sendMessage(down);
        this.sendMessage(up);
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    public static createEntryForDeviceList(
        _descriptor: GoogDeviceDescriptor,
        _blockClass: string,
        _fullName: string,
        _params: ParamsDeviceTracker,
    ): HTMLElement | DocumentFragment | undefined {
        return undefined;
    }
}

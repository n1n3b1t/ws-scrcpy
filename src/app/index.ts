import '../style/app.css';
import { StreamClientScrcpy } from './googDevice/client/StreamClientScrcpy';
import { MsePlayer } from './player/MsePlayer';
import { ACTION } from '../common/Action';
import { ParamsStreamScrcpy } from '../types/ParamsStreamScrcpy';

window.onload = async function (): Promise<void> {
    // Register the only decoder we support
    if (MsePlayer.isSupported()) {
        StreamClientScrcpy.registerPlayer(MsePlayer);
    } else {
        console.error('[ws-scrcpy] H264 Converter (MSE) is not supported by this browser.');
        return;
    }

    // Auto-connect mode: Server determines device from runtime environment
    const secure = location.protocol === 'https:';
    const wsProtocol = secure ? 'wss' : 'ws';
    const port = location.port ? parseInt(location.port, 10) : secure ? 443 : 80;
    const wsUrl = `${wsProtocol}://${location.hostname}:${port}/`;

    const params: ParamsStreamScrcpy = {
        action: ACTION.STREAM_SCRCPY,
        udid: 'auto',
        player: MsePlayer.playerCodeName,
        ws: wsUrl,
        secure,
        hostname: location.hostname,
        port,
        pathname: location.pathname,
        useProxy: false,
    };

    StreamClientScrcpy.start(params);
};

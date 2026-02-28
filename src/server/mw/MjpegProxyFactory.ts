import { Request, Response } from 'express';

// Stub since iOS code (`appl-device`) has been deleted.
export class MjpegProxyFactory {
    proxyRequest = async (_req: Request, res: Response): Promise<void> => {
        res.status(501).send('iOS support is disabled and removed.');
    };
}

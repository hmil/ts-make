import { currentTaskStack } from './thread';

export function log(message: string) {
    console.error(`[${currentTaskStack()}] ${message}`)
}

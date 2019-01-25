// import { Transform, Writable, Duplex } from "stream";

// const myTransform = new Transform({
//     writableObjectMode: true,
  
//     transform(chunk, encoding, callback) {
//         // Coerce the chunk to a number if necessary
//         chunk |= 0;
    
//         // Transform the chunk into something else.
//         const data = chunk.toString(16);
    
//         // Push the data onto the readable queue.
//         callback(undefined, '0'.repeat(data.length % 2) + data);
//     }
// });

// // Hook the console
// process.stdout = new Duplex().pipe(myTransform).pipe(process.stdout);

const oldConsole = console.log;
console.log = (text: string, ...params: any) => {
    const e = new Error();
    console.error(e.stack);
    oldConsole.apply(console, [Zone.current.name + " | " + text, ...params] )
}

// const oldWrite = process.stdout.write;
// process.stdout.write = write;

function write(buffer: Buffer | string, cb?: Function): boolean;
function write(str: string, encoding?: string, cb?: Function): boolean;
function write(strOrBuff: string | Buffer, encodingOrCb?: string | Function, cb?: Function): boolean {
    if (typeof strOrBuff === 'string') {
        if (typeof encodingOrCb === 'string') {
            return writeToString(process.stdout, strOrBuff, encodingOrCb, cb)
        } else if (typeof encodingOrCb == 'function') {
            return writeToString(process.stdout, strOrBuff, undefined, encodingOrCb)
        } else {
            return writeToString(process.stdout, strOrBuff, encodingOrCb, cb)
        }
    } else if (typeof encodingOrCb === 'function') {
        return writeToBuffer(process.stdout, strOrBuff, encodingOrCb);
    } else {
        return writeToBuffer(process.stdout, strOrBuff, undefined);
    }
}

function writeToString(ctx: NodeJS.WriteStream, str: string, encoding?: string, cb?: Function): boolean {
    return oldWrite.call(ctx, Zone.current.name + " | " + str, encoding, cb);
}

function writeToBuffer(ctx: NodeJS.WriteStream, buffer: Buffer, cb?: Function): boolean {
    // const toInsert = Buffer.from(Zone.current.name, "utf8");
    // const newBuff = Buffer.alloc(buffer.length + toInsert.length);
    // for (let i = 0 ; i < buffer.length ; i++) {
    //     const c = buffer.readInt8(i);
    //     newBuff.writeInt8(c, i);
    //     if (c == 10) { // \n
    //         i++;
    //         toInsert.copy(newBuff, i);
    //     }
    // }
    console.log('Hit');
    return oldWrite.call(ctx, buffer as any, cb as any);
}


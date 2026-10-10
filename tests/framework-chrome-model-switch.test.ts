import assert from "node:assert/strict";
import { test } from "node:test";
import { backgroundChannel, controlChannel, eventChannel } from "../apps/chrome/background-protocol";

test("Advanced switches models after a running session emits its own clear event during Stop", async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis,"chrome");
  let receive!: (message: unknown, sender: chrome.runtime.MessageSender, respond: (value: unknown)=>void)=>unknown;
  const commands: {type:string;options?:unknown}[] = [];
  const base = "chrome-extension://fixture/";
  const snapshot = {state:"idle",source:"en",message:"Stopped",captions:[]};
  const noop = {addListener(){}};
  Object.defineProperty(globalThis,"chrome",{configurable:true,value:{
    runtime:{id:"fixture",getURL:(path:string)=>base+path,ContextType:{OFFSCREEN_DOCUMENT:"OFFSCREEN_DOCUMENT"},
      async getContexts(){return [{documentUrl:`${base}offscreen.html`}];},onMessage:{addListener(listener: typeof receive){receive=listener;}},
      async sendMessage(message:{channel:string;command:{type:string;options?:unknown}}){
        assert.equal(message.channel,backgroundChannel);commands.push(message.command);
        if(message.command.type === "stop") receive({channel:eventChannel,type:"clear",identity:{sessionId:"previous",targetId:"tab",epoch:0}},{id:"fixture",url:`${base}offscreen.html`},()=>{});
        return {snapshot};
      },
    },tabs:{onRemoved:noop,onUpdated:noop},
  }});
  try {
    await import("../apps/chrome/service-worker");
    const response = await new Promise(resolve=>receive({channel:controlChannel,command:{type:"models",tabId:10,source:"en",options:{recognition:"tiny",translation:"m2m100"}}},{id:"fixture",url:`${base}advanced.html?source=en&tabId=10`},resolve));
    assert.deepEqual(response,{snapshot});
    assert.deepEqual(commands.map(c=>c.type),["stop","models"],"Retiring the old caption session must not cancel the newly selected model preparation");
    assert.deepEqual(commands[1].options,{recognition:"tiny",translation:"m2m100"});
  } finally {if(original)Object.defineProperty(globalThis,"chrome",original);else Reflect.deleteProperty(globalThis,"chrome");}
});

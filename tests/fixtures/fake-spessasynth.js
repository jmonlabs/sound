// A stand-in for spessasynth_lib: records the MIDI messages it is sent.
export const sent = [];
export class WorkletSynthesizer {
  constructor(context, config) {
    this.context = context;
    this.worklet = config.audioNodeCreators.worklet(context, "spessasynth-worklet-processor", {});
    this.soundBankManager = { addSoundBank: async (bytes, id) => sent.push(["bank", id, bytes.byteLength]) };
    this.isReady = Promise.resolve();
  }
  connectChannel(node, channel) { sent.push(["connect", channel, node.name]); }
  disconnectChannel(node, channel) { sent.push(["disconnect", channel]); }
  programChange(channel, program) { sent.push(["program", channel, program]); }
  controllerChange(channel, cc, value, options) { sent.push(["cc", channel, cc, value, options?.time]); }
  noteOn(channel, midi, velocity, options) { sent.push(["on", channel, midi, velocity, options?.time]); }
  noteOff(channel, midi, options) { sent.push(["off", channel, midi, options?.time]); }
}

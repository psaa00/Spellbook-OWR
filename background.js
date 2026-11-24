const SDK_URL = "https://esm.sh/@owlbear-rodeo/sdk@3.1.0";
const ROLL_CHANNEL = "com.psaa00.spellbook/rolls";

async function start() {
  try {
    const mod = await import(SDK_URL);
    const OBR = mod.default || mod.OBR || mod;
    if (!OBR.isAvailable) return;
    if (!OBR.isReady) await new Promise((resolve) => {
      let off;
      const done = () => { off?.(); resolve(); };
      off = OBR.onReady(done);
      setTimeout(done, 12000);
    });
    OBR.broadcast?.onMessage(ROLL_CHANNEL, (event) => {
      const roll = event?.data;
      if (!roll || roll.kind !== "spell-damage-roll" || typeof roll.total !== "number") return;
      const message = `${roll.spellName || "Заклинание"}: ${roll.details || `${roll.formula} = ${roll.total}`}`;
      OBR.notification?.show(message, "INFO").catch((error) => console.warn("Spellbook notification failed", error));
    });
  } catch (error) {
    console.warn("Spellbook background could not connect to Owlbear Rodeo", error);
  }
}

start();

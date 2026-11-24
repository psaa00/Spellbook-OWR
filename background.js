const SDK_URL = "https://esm.sh/@owlbear-rodeo/sdk@3.1.0";
const ROLL_CHANNEL = "com.psaa00.spellbook/rolls";

async function start() {
  try {
    const mod = await import(SDK_URL);
    const OBR = mod.default || mod.OBR || mod;
    if (!OBR.isAvailable) return;
    if (!OBR.isReady) {
      await new Promise((resolve, reject) => {
        let off = null;
        let settled = false;
        const finish = (error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          try { off?.(); } catch { /* no-op */ }
          if (error) reject(error); else resolve();
        };
        const timer = setTimeout(() => finish(new Error("Owlbear Rodeo did not become ready in time")), 20000);
        off = OBR.onReady(() => finish());
      });
    }
    if (!OBR.isReady) throw new Error("Owlbear Rodeo SDK is not ready; broadcast listener was not started");
    if (!OBR.room?.id) {
      console.info("Spellbook background: no active game room; broadcast listener skipped.");
      return;
    }
    OBR.broadcast?.onMessage(ROLL_CHANNEL, (event) => {
      const roll = event?.data;
      if (!roll || roll.kind !== "spell-damage-roll" || typeof roll.total !== "number") return;
      const message = `${roll.spellName || "Заклинание"}: ${roll.details || `${roll.formula} = ${roll.total}`}`;
      try {
        Promise.resolve(OBR.notification?.show?.(message, "INFO"))
          .catch((error) => console.warn("Spellbook notification failed", error));
      } catch (error) {
        console.warn("Spellbook notification failed", error);
      }
    });
  } catch (error) {
    console.warn("Spellbook background could not connect to Owlbear Rodeo", error);
  }
}

start();

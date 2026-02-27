(() => {
  "use strict";

  const canvas = document.getElementById("gameCanvas");
  const ctx = canvas.getContext("2d");
  const soundToggleButton = document.getElementById("soundToggle");

  const WIDTH = canvas.width;
  const HEIGHT = canvas.height;
  const FIXED_DT = 1 / 120;
  const GRAVITY = 1800;
  const DEG_TO_RAD = Math.PI / 180;

  const Utils = {
    clamp(value, min, max) {
      return Math.max(min, Math.min(max, value));
    },

    lerp(a, b, t) {
      return a + (b - a) * t;
    },

    length(x, y) {
      return Math.hypot(x, y);
    },

    normalize(x, y) {
      const len = Math.hypot(x, y) || 1;
      return { x: x / len, y: y / len };
    },

    pointInRect(px, py, rect) {
      return (
        px >= rect.x &&
        px <= rect.x + rect.w &&
        py >= rect.y &&
        py <= rect.y + rect.h
      );
    },

    formatPoints(value) {
      return `${Math.round(value)} pts`;
    },

    drawButton(context, button) {
      context.save();
      context.fillStyle = button.hover ? "#204f76" : "#2a6694";
      context.strokeStyle = "#0f2f4c";
      context.lineWidth = 2;
      context.fillRect(button.x, button.y, button.w, button.h);
      context.strokeRect(button.x, button.y, button.w, button.h);

      context.fillStyle = "#ffffff";
      context.font = "bold 24px Trebuchet MS";
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText(button.label, button.x + button.w / 2, button.y + button.h / 2);
      context.restore();
    },

    drawChargeMeter(context, x, y, w, h, ratio, label) {
      const clamped = Utils.clamp(ratio, 0, 1);

      context.save();
      context.fillStyle = "#ffffff";
      context.globalAlpha = 0.9;
      context.fillRect(x, y, w, h);

      context.fillStyle = "#38a04a";
      context.fillRect(x, y, w * clamped, h);

      context.strokeStyle = "#173248";
      context.lineWidth = 2;
      context.strokeRect(x, y, w, h);

      context.fillStyle = "#173248";
      context.font = "bold 15px Trebuchet MS";
      context.textAlign = "left";
      context.textBaseline = "bottom";
      context.fillText(label, x, y - 6);
      context.restore();
    },

    drawTimingMeter(context, x, y, w, h, needle) {
      context.save();

      // Red / yellow / green zones for deterministic timing judgment.
      const zones = [
        { start: 0.0, end: 0.3, color: "#d84a4a" },
        { start: 0.3, end: 0.42, color: "#f2c94c" },
        { start: 0.42, end: 0.58, color: "#35b66a" },
        { start: 0.58, end: 0.7, color: "#f2c94c" },
        { start: 0.7, end: 1.0, color: "#d84a4a" }
      ];

      for (const zone of zones) {
        context.fillStyle = zone.color;
        context.fillRect(x + zone.start * w, y, (zone.end - zone.start) * w, h);
      }

      context.strokeStyle = "#173248";
      context.lineWidth = 2;
      context.strokeRect(x, y, w, h);

      const nx = x + Utils.clamp(needle, 0, 1) * w;
      context.strokeStyle = "#0e1c28";
      context.lineWidth = 3;
      context.beginPath();
      context.moveTo(nx, y - 6);
      context.lineTo(nx, y + h + 6);
      context.stroke();

      context.restore();
    },

    createButton(x, y, w, h, label, onClick) {
      return { x, y, w, h, label, onClick, hover: false };
    }
  };

  const Sound = {
    enabled: true,
    context: null,

    ensureContext() {
      if (!this.context) {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) {
          return null;
        }
        this.context = new AudioCtx();
      }

      if (this.context.state === "suspended") {
        this.context.resume().catch(() => {});
      }

      return this.context;
    },

    setEnabled(enabled) {
      this.enabled = Boolean(enabled);
      soundToggleButton.textContent = this.enabled ? "Sound: On" : "Sound: Off";
      soundToggleButton.setAttribute("aria-pressed", String(this.enabled));
    },

    toggle() {
      this.setEnabled(!this.enabled);
    },

    beep({ freq = 440, duration = 0.08, type = "sine", volume = 0.035 } = {}) {
      if (!this.enabled) {
        return;
      }

      const ac = this.ensureContext();
      if (!ac) {
        return;
      }

      const now = ac.currentTime;
      const osc = ac.createOscillator();
      const gain = ac.createGain();

      osc.type = type;
      osc.frequency.setValueAtTime(freq, now);

      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(volume, now + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

      osc.connect(gain);
      gain.connect(ac.destination);
      osc.start(now);
      osc.stop(now + duration + 0.02);
    }
  };

  const Input = {
    keys: new Set(),
    mouseX: 0,
    mouseY: 0,
    routeInput: () => {},

    init(routeInput) {
      this.routeInput = routeInput;

      window.addEventListener("keydown", (event) => {
        if (["Space", "ArrowUp", "ArrowDown"].includes(event.code)) {
          event.preventDefault();
        }

        this.keys.add(event.code);
        this.routeInput("keydown", { code: event.code, repeat: event.repeat });
      });

      window.addEventListener("keyup", (event) => {
        if (["Space", "ArrowUp", "ArrowDown"].includes(event.code)) {
          event.preventDefault();
        }

        this.keys.delete(event.code);
        this.routeInput("keyup", { code: event.code });
      });

      canvas.addEventListener("mousemove", (event) => {
        const point = this.toCanvasPoint(event);
        this.mouseX = point.x;
        this.mouseY = point.y;
        this.routeInput("pointermove", point);
      });

      canvas.addEventListener("mousedown", (event) => {
        const point = this.toCanvasPoint(event);
        this.mouseX = point.x;
        this.mouseY = point.y;
        Sound.ensureContext();
        this.routeInput("pointerdown", point);
      });

      canvas.addEventListener("mouseup", (event) => {
        const point = this.toCanvasPoint(event);
        this.mouseX = point.x;
        this.mouseY = point.y;
        this.routeInput("pointerup", point);
      });
    },

    isDown(code) {
      return this.keys.has(code);
    },

    toCanvasPoint(event) {
      const rect = canvas.getBoundingClientRect();
      return {
        x: (event.clientX - rect.left) * (canvas.width / rect.width),
        y: (event.clientY - rect.top) * (canvas.height / rect.height)
      };
    }
  };

  function createFigureSkatingEvent() {
    const totalJumps = 5;
    const groundY = 470;

    const event = {
      name: "Figure Skating",
      score: 0,
      jumpsCompleted: 0,
      phase: "ready",
      finished: false,
      skaterY: groundY,
      skaterVy: 0,
      peakY: groundY,
      charge: 0,
      chargeRate: 0.9,
      needle: 0,
      needleDirection: 1,
      needleSpeed: 1.5,
      timingError: 0,
      timingMultiplier: 1,
      landingMultiplier: 1,
      jumpMessage: "",
      pauseTimer: 0,

      reset() {
        this.score = 0;
        this.jumpsCompleted = 0;
        this.phase = "ready";
        this.finished = false;
        this.skaterY = groundY;
        this.skaterVy = 0;
        this.peakY = groundY;
        this.charge = 0;
        this.needle = 0;
        this.needleDirection = 1;
        this.timingError = 0;
        this.timingMultiplier = 1;
        this.landingMultiplier = 1;
        this.jumpMessage = "Hold SPACE to charge, release near green.";
        this.pauseTimer = 0;
      },

      updateNeedle(dt) {
        this.needle += this.needleDirection * this.needleSpeed * dt;
        if (this.needle > 1) {
          this.needle = 2 - this.needle;
          this.needleDirection = -1;
        }
        if (this.needle < 0) {
          this.needle = -this.needle;
          this.needleDirection = 1;
        }
      },

      evaluateTiming(needle) {
        const error = Math.abs(needle - 0.5);

        if (needle >= 0.42 && needle <= 0.58) {
          return { label: "Perfect timing", multiplier: 1.25, error };
        }

        if ((needle >= 0.3 && needle < 0.42) || (needle > 0.58 && needle <= 0.7)) {
          return { label: "Okay timing", multiplier: 1.0, error };
        }

        return { label: "Bad timing", multiplier: 0.7, error };
      },

      startJump() {
        const timing = this.evaluateTiming(this.needle);
        this.timingError = timing.error;
        this.timingMultiplier = timing.multiplier;

        const timingAccuracy = 1 - Utils.clamp(this.timingError / 0.5, 0, 1);
        const takeoffSpeed = 620 + 520 * this.charge + 140 * timingAccuracy;

        this.skaterVy = -takeoffSpeed;
        this.peakY = this.skaterY;
        this.phase = "air";
        this.jumpMessage = `${timing.label} locked`;
        Sound.beep({ freq: 620, duration: 0.06, volume: 0.03 });
      },

      resolveLanding() {
        const jumpIndex = this.jumpsCompleted;
        const baseDifficulty = 120 + jumpIndex * 45;
        const requiredHeight = 95 + jumpIndex * 22;
        const jumpHeight = groundY - this.peakY;
        const heightRatio = jumpHeight / requiredHeight;

        // Landing multiplier is deterministic from timing quality and achieved jump height.
        let landingMultiplier = 0.45;
        let landingLabel = "Rough landing";

        if (this.timingError <= 0.08 && heightRatio >= 1.05) {
          landingMultiplier = 1.35;
          landingLabel = "Clean landing";
        } else if (this.timingError <= 0.16 && heightRatio >= 0.9) {
          landingMultiplier = 1.1;
          landingLabel = "Good landing";
        } else if (this.timingError <= 0.24 && heightRatio >= 0.75) {
          landingMultiplier = 0.8;
          landingLabel = "Sketchy landing";
        }

        this.landingMultiplier = landingMultiplier;
        const points = Math.round(baseDifficulty * this.timingMultiplier * landingMultiplier);
        this.score += points;
        this.jumpsCompleted += 1;

        this.jumpMessage = `${landingLabel}: +${points} (${Math.round(jumpHeight)} px height)`;
        Sound.beep({ freq: 360 + points * 0.2, duration: 0.09, type: "triangle", volume: 0.04 });

        if (this.jumpsCompleted >= totalJumps) {
          this.phase = "complete";
          this.finished = true;
          this.jumpMessage = `Routine complete: ${Utils.formatPoints(this.score)}`;
        } else {
          this.phase = "pause";
          this.pauseTimer = 0.6;
        }
      },

      update(dt) {
        if (this.phase === "complete") {
          return;
        }

        if (this.phase === "ready" || this.phase === "charging") {
          this.updateNeedle(dt);
        }

        if (this.phase === "charging") {
          this.charge = Utils.clamp(this.charge + this.chargeRate * dt, 0, 1);
        }

        if (this.phase === "air") {
          this.skaterVy += GRAVITY * dt;
          this.skaterY += this.skaterVy * dt;

          if (this.skaterY < this.peakY) {
            this.peakY = this.skaterY;
          }

          if (this.skaterY >= groundY && this.skaterVy > 0) {
            this.skaterY = groundY;
            this.skaterVy = 0;
            this.resolveLanding();
          }
        }

        if (this.phase === "pause") {
          this.pauseTimer -= dt;
          if (this.pauseTimer <= 0) {
            this.phase = "ready";
            this.charge = 0;
            this.jumpMessage = "Next jump: hold SPACE to charge.";
          }
        }
      },

      draw(context) {
        context.save();

        context.fillStyle = "#d9f2ff";
        context.fillRect(0, 0, WIDTH, HEIGHT);

        context.fillStyle = "#d0e8f7";
        context.fillRect(0, groundY + 15, WIDTH, HEIGHT - groundY - 15);

        context.strokeStyle = "#aac7da";
        context.lineWidth = 2;
        for (let x = 40; x < WIDTH; x += 80) {
          context.beginPath();
          context.moveTo(x, groundY + 20);
          context.lineTo(x + 28, HEIGHT);
          context.stroke();
        }

        // Simple skater avatar.
        const skaterX = 230;
        context.fillStyle = "#2a4560";
        context.beginPath();
        context.arc(skaterX, this.skaterY - 24, 12, 0, Math.PI * 2);
        context.fill();

        context.strokeStyle = "#1f3042";
        context.lineWidth = 6;
        context.beginPath();
        context.moveTo(skaterX, this.skaterY - 12);
        context.lineTo(skaterX, this.skaterY + 18);
        context.stroke();

        context.strokeStyle = "#6c7f93";
        context.lineWidth = 5;
        context.beginPath();
        context.moveTo(skaterX - 16, groundY + 19);
        context.lineTo(skaterX + 16, groundY + 19);
        context.stroke();

        Utils.drawTimingMeter(context, 300, 70, 460, 26, this.needle);
        Utils.drawChargeMeter(context, 300, 118, 460, 16, this.charge, "Jump Power");

        context.fillStyle = "#173248";
        context.font = "bold 18px Trebuchet MS";
        context.textAlign = "left";
        context.fillText(this.jumpMessage, 300, 160);

        context.restore();
      },

      handleInput(eventType, payload) {
        if (this.finished) {
          return;
        }

        if (eventType === "keydown" && payload.code === "Space" && !payload.repeat) {
          if (this.phase === "ready") {
            this.phase = "charging";
            this.charge = 0;
            Sound.beep({ freq: 520, duration: 0.04, volume: 0.02 });
          }
        }

        if (eventType === "keyup" && payload.code === "Space") {
          if (this.phase === "charging") {
            this.startJump();
          }
        }
      },

      getHUD() {
        const instructionsByPhase = {
          ready: "Hold SPACE to charge jump; release as needle crosses green.",
          charging: "Release SPACE to commit timing and power.",
          air: "In-air simulation running. Prepare for landing.",
          pause: "Landing judged. Resetting for next jump.",
          complete: "Routine complete. Returning to results."
        };

        return {
          eventName: this.name,
          instructions: instructionsByPhase[this.phase] || "",
          attemptsRemaining: totalJumps - this.jumpsCompleted,
          score: this.score
        };
      }
    };

    event.reset();
    return event;
  }

  function createCurlingEvent() {
    const rink = { x: 80, y: 100, w: 740, h: 400 };
    const house = { x: 700, y: 300 };
    const stoneRadius = 14;
    const totalStones = 3;

    const event = {
      name: "Curling",
      score: 0,
      stonesUsed: 0,
      phase: "ready",
      finished: false,
      charge: 0,
      chargeRate: 0.78,
      aimDeg: 0,
      brushHeld: false,
      scoreTimer: 0,
      lastStoneScore: 0,
      stone: {
        x: 140,
        y: 300,
        vx: 0,
        vy: 0,
        curlSign: 1
      },
      trail: [],

      resetStone() {
        this.stone.x = 140;
        this.stone.y = 300;
        this.stone.vx = 0;
        this.stone.vy = 0;
        this.stone.curlSign = this.aimDeg >= 0 ? 1 : -1;
        this.trail = [];
      },

      reset() {
        this.score = 0;
        this.stonesUsed = 0;
        this.phase = "ready";
        this.finished = false;
        this.charge = 0;
        this.chargeRate = 0.78;
        this.aimDeg = 0;
        this.brushHeld = false;
        this.scoreTimer = 0;
        this.lastStoneScore = 0;
        this.resetStone();
      },

      launchStone() {
        const speed = 320 + 900 * this.charge;
        const angle = this.aimDeg * DEG_TO_RAD;

        this.stone.vx = speed * Math.cos(angle);
        this.stone.vy = speed * Math.sin(angle);
        this.stone.curlSign = this.aimDeg === 0 ? (this.stonesUsed % 2 === 0 ? 1 : -1) : Math.sign(this.aimDeg);

        this.phase = "sliding";
        Sound.beep({ freq: 500, duration: 0.06, type: "square", volume: 0.03 });
      },

      scoreStone() {
        const dx = this.stone.x - house.x;
        const dy = this.stone.y - house.y;
        const distance = Math.hypot(dx, dy);

        let points = 0;
        if (distance < 15) {
          points = 100;
        } else if (distance < 40) {
          points = 60;
        } else if (distance < 80) {
          points = 30;
        }

        this.lastStoneScore = points;
        this.score += points;
        this.stonesUsed += 1;
        this.phase = "scored";
        this.scoreTimer = 1.0;

        Sound.beep({ freq: 280 + points * 3, duration: 0.09, type: "triangle", volume: 0.04 });
      },

      update(dt) {
        if (this.phase === "complete") {
          return;
        }

        if (this.phase === "charging") {
          this.charge = Utils.clamp(this.charge + this.chargeRate * dt, 0, 1);
        }

        if (this.phase === "sliding") {
          const mu = this.brushHeld ? 0.08 : 0.2;
          const speed = Utils.length(this.stone.vx, this.stone.vy);

          if (speed > 0) {
            // Deterministic friction model shared with requested convention.
            const decel = mu * GRAVITY * dt;
            const nextSpeed = Math.max(0, speed - decel);
            const ratio = speed > 0 ? nextSpeed / speed : 0;

            this.stone.vx *= ratio;
            this.stone.vy *= ratio;

            // Mild speed-dependent curl to reward proper aiming.
            this.stone.vy += this.stone.curlSign * 22 * (nextSpeed / 900) * dt;

            this.stone.x += this.stone.vx * dt;
            this.stone.y += this.stone.vy * dt;

            this.trail.push({ x: this.stone.x, y: this.stone.y });
            if (this.trail.length > 45) {
              this.trail.shift();
            }
          }

          const minY = rink.y + stoneRadius;
          const maxY = rink.y + rink.h - stoneRadius;

          if (this.stone.y < minY) {
            this.stone.y = minY;
            this.stone.vy = Math.abs(this.stone.vy) * 0.3;
          } else if (this.stone.y > maxY) {
            this.stone.y = maxY;
            this.stone.vy = -Math.abs(this.stone.vy) * 0.3;
          }

          const speedNow = Utils.length(this.stone.vx, this.stone.vy);
          if (speedNow <= 2) {
            this.stone.vx = 0;
            this.stone.vy = 0;
            this.scoreStone();
          }
        }

        if (this.phase === "scored") {
          this.scoreTimer -= dt;
          if (this.scoreTimer <= 0) {
            if (this.stonesUsed >= totalStones) {
              this.phase = "complete";
              this.finished = true;
            } else {
              this.phase = "ready";
              this.charge = 0;
              this.aimDeg = 0;
              this.brushHeld = false;
              this.resetStone();
            }
          }
        }
      },

      draw(context) {
        context.save();

        context.fillStyle = "#d8f2ff";
        context.fillRect(0, 0, WIDTH, HEIGHT);

        context.fillStyle = "#edf9ff";
        context.fillRect(rink.x, rink.y, rink.w, rink.h);

        context.strokeStyle = "#8cb8d3";
        context.lineWidth = 2;
        context.strokeRect(rink.x, rink.y, rink.w, rink.h);

        context.beginPath();
        context.strokeStyle = "#aacfe7";
        context.moveTo(rink.x + 70, rink.y);
        context.lineTo(rink.x + 70, rink.y + rink.h);
        context.stroke();

        for (const ring of [80, 40, 15]) {
          context.beginPath();
          context.arc(house.x, house.y, ring, 0, Math.PI * 2);
          context.fillStyle = ring === 80 ? "#6fc2f2" : ring === 40 ? "#ffffff" : "#ff6767";
          context.fill();
          context.strokeStyle = "#3f789e";
          context.stroke();
        }

        if (this.phase === "ready" || this.phase === "charging") {
          const aimRad = this.aimDeg * DEG_TO_RAD;
          const aimLength = 120 + this.charge * 130;
          context.strokeStyle = "#2a668f";
          context.lineWidth = 3;
          context.beginPath();
          context.moveTo(this.stone.x, this.stone.y);
          context.lineTo(
            this.stone.x + Math.cos(aimRad) * aimLength,
            this.stone.y + Math.sin(aimRad) * aimLength
          );
          context.stroke();
        }

        for (let i = 0; i < this.trail.length; i += 1) {
          const p = this.trail[i];
          const alpha = i / this.trail.length;
          context.fillStyle = `rgba(90, 130, 160, ${alpha * 0.35})`;
          context.beginPath();
          context.arc(p.x, p.y, 4, 0, Math.PI * 2);
          context.fill();
        }

        context.beginPath();
        context.arc(this.stone.x, this.stone.y, stoneRadius, 0, Math.PI * 2);
        context.fillStyle = "#7d8f9d";
        context.fill();
        context.strokeStyle = "#364955";
        context.lineWidth = 2;
        context.stroke();

        Utils.drawChargeMeter(context, 120, 65, 320, 16, this.charge, "Push Power");

        context.fillStyle = "#173248";
        context.font = "bold 18px Trebuchet MS";
        context.textAlign = "left";
        context.fillText(`Aim: ${this.aimDeg.toFixed(1)} deg`, 470, 79);

        if (this.phase === "sliding") {
          context.fillText(this.brushHeld ? "Brushing ON (B)" : "Brushing OFF (hold B)", 630, 79);
        } else if (this.phase === "scored") {
          context.fillText(`Stone score: ${this.lastStoneScore}`, 630, 79);
        }

        context.restore();
      },

      handleInput(eventType, payload) {
        if (this.finished) {
          return;
        }

        if (eventType === "keydown") {
          if (payload.code === "ArrowUp" && (this.phase === "ready" || this.phase === "charging")) {
            this.aimDeg = Utils.clamp(this.aimDeg - 1.5, -14, 14);
          }

          if (payload.code === "ArrowDown" && (this.phase === "ready" || this.phase === "charging")) {
            this.aimDeg = Utils.clamp(this.aimDeg + 1.5, -14, 14);
          }

          if (payload.code === "Space" && !payload.repeat && this.phase === "ready") {
            this.phase = "charging";
            this.charge = 0;
            Sound.beep({ freq: 510, duration: 0.04, volume: 0.02 });
          }

          if (payload.code === "KeyB") {
            this.brushHeld = true;
          }
        }

        if (eventType === "keyup") {
          if (payload.code === "Space" && this.phase === "charging") {
            this.launchStone();
          }

          if (payload.code === "KeyB") {
            this.brushHeld = false;
          }
        }
      },

      getHUD() {
        const instructionsByPhase = {
          ready: "UP/DOWN aim, hold SPACE to set push power, release to throw.",
          charging: "Release SPACE to launch the stone.",
          sliding: "Hold B to brush and reduce friction (mu 0.20 -> 0.08).",
          scored: "Stone stopped. Scoring this throw.",
          complete: "End complete. Returning to results."
        };

        return {
          eventName: this.name,
          instructions: instructionsByPhase[this.phase] || "",
          attemptsRemaining: totalStones - this.stonesUsed,
          score: this.score
        };
      }
    };

    event.reset();
    return event;
  }

  function createSkiJumpEvent() {
    const rampStart = { x: 120, y: 120 };
    const lip = { x: 330, y: 300 };
    const hillEnd = { x: 860, y: 560 };

    const rampDx = lip.x - rampStart.x;
    const rampDy = lip.y - rampStart.y;
    const rampLength = Math.hypot(rampDx, rampDy);
    const rampTangent = { x: rampDx / rampLength, y: rampDy / rampLength };
    const rampNormal = { x: rampTangent.y, y: -rampTangent.x };

    const hillSlope = (hillEnd.y - lip.y) / (hillEnd.x - lip.x);
    const hillAngleDeg = Math.atan2(hillEnd.y - lip.y, hillEnd.x - lip.x) / DEG_TO_RAD;

    const event = {
      name: "Ski Jump",
      score: 0,
      attemptsTotal: 1,
      attemptsUsed: 0,
      phase: "ramp",
      finished: false,
      loading: false,
      load: 0,
      loadRate: 0.9,
      takeoffLocked: false,
      timingFactor: 0.35,
      landingMessage: "",
      doneTimer: 0,
      skier: {
        s: 0,
        speedAlong: 0,
        x: rampStart.x,
        y: rampStart.y,
        vx: 0,
        vy: 0,
        pitchDeg: 6
      },
      trail: [],

      hillY(x) {
        const clampedX = Utils.clamp(x, lip.x, hillEnd.x);
        return lip.y + hillSlope * (clampedX - lip.x);
      },

      reset() {
        this.score = 0;
        this.attemptsUsed = 0;
        this.phase = "ramp";
        this.finished = false;
        this.loading = false;
        this.load = 0;
        this.takeoffLocked = false;
        this.timingFactor = 0.35;
        this.landingMessage = "Hold SPACE while descending, release near lip.";
        this.doneTimer = 0;

        this.skier.s = 0;
        this.skier.speedAlong = 0;
        this.skier.x = rampStart.x;
        this.skier.y = rampStart.y;
        this.skier.vx = 0;
        this.skier.vy = 0;
        this.skier.pitchDeg = 6;

        this.trail = [];
      },

      computeTimingFactor(distanceToLip) {
        const windowPx = 170;
        const normalized = Utils.clamp(1 - distanceToLip / windowPx, 0, 1);
        return 0.3 + normalized * 0.7;
      },

      enterFlight() {
        this.phase = "flight";

        const loadFactor = 0.55 + 0.45 * this.load;
        const impulse = 340 * loadFactor * this.timingFactor;

        // Velocity at lip combines ramp speed + takeoff impulse.
        this.skier.x = lip.x;
        this.skier.y = lip.y;
        this.skier.vx = rampTangent.x * this.skier.speedAlong + rampNormal.x * impulse;
        this.skier.vy = rampTangent.y * this.skier.speedAlong + rampNormal.y * impulse;
        this.skier.pitchDeg = 7;

        Sound.beep({ freq: 540, duration: 0.07, type: "square", volume: 0.04 });
      },

      resolveLanding() {
        this.phase = "landed";
        this.attemptsUsed = 1;

        const distancePx = Math.max(0, this.skier.x - lip.x);
        const distanceMeters = distancePx / 6;

        const safePitch = Math.abs(this.skier.pitchDeg - 8) <= 8;
        const safeVSpeed = this.skier.vy < 360;

        let bonus = 0;
        if (safePitch && safeVSpeed) {
          bonus = 35;
          this.landingMessage = "Telemark-style landing bonus";
        } else if (safeVSpeed) {
          bonus = 15;
          this.landingMessage = "Stable landing bonus";
        } else {
          this.landingMessage = "Hard landing";
        }

        this.score = Math.round(distanceMeters + bonus);
        this.doneTimer = 1.2;

        Sound.beep({ freq: 280 + distanceMeters * 4, duration: 0.1, type: "triangle", volume: 0.04 });
      },

      updateRamp(dt) {
        const rampAcceleration = 780;
        this.skier.speedAlong += rampAcceleration * dt;

        if (this.loading && !this.takeoffLocked) {
          this.load = Utils.clamp(this.load + this.loadRate * dt, 0, 1);
        }

        this.skier.s += this.skier.speedAlong * dt;
        if (this.skier.s >= rampLength) {
          this.skier.s = rampLength;

          if (!this.takeoffLocked) {
            this.timingFactor = 1;
            this.takeoffLocked = true;
            this.loading = false;
          }

          this.enterFlight();
        }

        this.skier.x = rampStart.x + rampTangent.x * this.skier.s;
        this.skier.y = rampStart.y + rampTangent.y * this.skier.s;
      },

      updateFlight(dt) {
        if (Input.isDown("ArrowUp")) {
          this.skier.pitchDeg = Utils.clamp(this.skier.pitchDeg + 55 * dt, -20, 20);
        }
        if (Input.isDown("ArrowDown")) {
          this.skier.pitchDeg = Utils.clamp(this.skier.pitchDeg - 55 * dt, -20, 20);
        }

        const speed = Utils.length(this.skier.vx, this.skier.vy);
        const velUnit = Utils.normalize(this.skier.vx, this.skier.vy);

        // Sweet spot for lift is slightly nose-up near +8 degrees.
        const pitch = this.skier.pitchDeg;
        const clShape = 1 - ((pitch - 8) * (pitch - 8)) / 900;
        const Cl = 0.00024 * Math.max(0, clShape);
        const Cd = 0.00009 + 0.000004 * (pitch + 2) * (pitch + 2);

        const lift = Cl * speed * speed;
        const drag = Cd * speed * speed;

        const liftDir = { x: velUnit.y, y: -velUnit.x };

        const ax = -drag * velUnit.x + lift * liftDir.x;
        const ay = GRAVITY - drag * velUnit.y + lift * liftDir.y;

        this.skier.vx += ax * dt;
        this.skier.vy += ay * dt;
        this.skier.x += this.skier.vx * dt;
        this.skier.y += this.skier.vy * dt;

        this.trail.push({ x: this.skier.x, y: this.skier.y });
        if (this.trail.length > 60) {
          this.trail.shift();
        }

        const hillY = this.hillY(this.skier.x);
        if (this.skier.x >= lip.x && this.skier.y >= hillY) {
          this.skier.y = hillY;
          this.resolveLanding();
        }

        if (this.skier.x > WIDTH + 100 || this.skier.y > HEIGHT + 120) {
          this.phase = "complete";
          this.attemptsUsed = 1;
          this.finished = true;
          this.score = 0;
          this.landingMessage = "Jump missed landing hill";
        }
      },

      update(dt) {
        if (this.phase === "complete") {
          return;
        }

        if (this.phase === "ramp") {
          this.updateRamp(dt);
        } else if (this.phase === "flight") {
          this.updateFlight(dt);
        } else if (this.phase === "landed") {
          this.doneTimer -= dt;
          if (this.doneTimer <= 0) {
            this.phase = "complete";
            this.finished = true;
          }
        }
      },

      draw(context) {
        context.save();

        context.fillStyle = "#c7e9ff";
        context.fillRect(0, 0, WIDTH, HEIGHT);

        context.fillStyle = "#eef9ff";
        context.beginPath();
        context.moveTo(rampStart.x - 40, rampStart.y - 18);
        context.lineTo(lip.x, lip.y);
        context.lineTo(lip.x + 20, lip.y + 40);
        context.lineTo(rampStart.x - 40, rampStart.y + 18);
        context.closePath();
        context.fill();

        context.fillStyle = "#e8f5ff";
        context.beginPath();
        context.moveTo(lip.x, lip.y);
        context.lineTo(hillEnd.x, hillEnd.y);
        context.lineTo(hillEnd.x, HEIGHT);
        context.lineTo(lip.x, HEIGHT);
        context.closePath();
        context.fill();

        context.strokeStyle = "#8ab4d0";
        context.lineWidth = 3;
        context.beginPath();
        context.moveTo(rampStart.x, rampStart.y);
        context.lineTo(lip.x, lip.y);
        context.stroke();

        context.beginPath();
        context.moveTo(lip.x, lip.y);
        context.lineTo(hillEnd.x, hillEnd.y);
        context.stroke();

        for (let i = 0; i < this.trail.length; i += 1) {
          const p = this.trail[i];
          const alpha = i / this.trail.length;
          context.fillStyle = `rgba(70, 110, 140, ${alpha * 0.3})`;
          context.beginPath();
          context.arc(p.x, p.y, 3, 0, Math.PI * 2);
          context.fill();
        }

        context.save();
        context.translate(this.skier.x, this.skier.y);
        context.rotate((-this.skier.pitchDeg + hillAngleDeg * 0.12) * DEG_TO_RAD);

        context.strokeStyle = "#1a2d3f";
        context.lineWidth = 5;
        context.beginPath();
        context.moveTo(-18, 0);
        context.lineTo(18, 0);
        context.stroke();

        context.fillStyle = "#213f5b";
        context.beginPath();
        context.arc(0, -10, 9, 0, Math.PI * 2);
        context.fill();

        context.restore();

        Utils.drawChargeMeter(context, 110, 65, 320, 16, this.load, "Leg Load");

        context.fillStyle = "#173248";
        context.font = "bold 18px Trebuchet MS";
        context.textAlign = "left";
        context.fillText(`Takeoff timing: ${(this.timingFactor * 100).toFixed(0)}%`, 460, 79);

        if (this.phase === "flight" || this.phase === "landed" || this.phase === "complete") {
          context.fillText(`Pitch: ${this.skier.pitchDeg.toFixed(1)} deg`, 700, 79);
        }

        if (this.landingMessage) {
          context.fillText(this.landingMessage, 460, 108);
        }

        context.restore();
      },

      handleInput(eventType, payload) {
        if (this.finished) {
          return;
        }

        if (this.phase === "ramp") {
          if (eventType === "keydown" && payload.code === "Space" && !payload.repeat && !this.takeoffLocked) {
            this.loading = true;
            Sound.beep({ freq: 510, duration: 0.04, volume: 0.02 });
          }

          if (eventType === "keyup" && payload.code === "Space" && this.loading && !this.takeoffLocked) {
            this.loading = false;
            const distToLip = Math.max(0, rampLength - this.skier.s);
            this.timingFactor = this.computeTimingFactor(distToLip);
            this.takeoffLocked = true;
            Sound.beep({ freq: 660, duration: 0.05, volume: 0.03 });
          }
        }
      },

      getHUD() {
        const instructionsByPhase = {
          ramp: "Hold SPACE while descending and release near lip for best impulse.",
          flight: "Use UP/DOWN to tune pitch (-20 deg to +20 deg) for lift and low drag.",
          landed: "Landing judged. Final score stabilizing.",
          complete: "Jump complete. Returning to results."
        };

        return {
          eventName: this.name,
          instructions: instructionsByPhase[this.phase] || "",
          attemptsRemaining: this.attemptsTotal - this.attemptsUsed,
          score: this.score
        };
      }
    };

    event.reset();
    return event;
  }

  const app = {
    state: "menu", // menu | event | results
    activeEventKey: "",
    activeEvent: null,
    results: {
      eventName: "",
      score: 0
    },
    events: {
      figure: createFigureSkatingEvent(),
      curling: createCurlingEvent(),
      ski: createSkiJumpEvent()
    },
    ui: {
      menuButtons: [],
      backButton: null
    },
    transition: {
      alpha: 0,
      dir: 0,
      speed: 2.8,
      pendingAction: null
    },
    particles: []
  };

  function initParticles() {
    app.particles = [];
    for (let i = 0; i < 36; i += 1) {
      app.particles.push({
        x: Math.random() * WIDTH,
        y: Math.random() * HEIGHT,
        r: 1.5 + Math.random() * 2,
        vx: 6 + Math.random() * 14,
        vy: -2 + Math.random() * 4
      });
    }
  }

  function initUI() {
    app.ui.menuButtons = [
      Utils.createButton(320, 210, 260, 64, "Figure Skating", () => selectEvent("figure")),
      Utils.createButton(320, 294, 260, 64, "Curling", () => selectEvent("curling")),
      Utils.createButton(320, 378, 260, 64, "Ski Jump", () => selectEvent("ski"))
    ];

    app.ui.backButton = Utils.createButton(345, 390, 210, 62, "Back to Menu", () => {
      startTransition(() => {
        app.state = "menu";
      });
    });
  }

  function selectEvent(key) {
    startTransition(() => {
      const event = app.events[key];
      event.reset();
      app.activeEvent = event;
      app.activeEventKey = key;
      app.state = "event";
    });
  }

  function startTransition(action) {
    if (app.transition.dir !== 0) {
      return;
    }

    app.transition.pendingAction = action;
    app.transition.dir = 1;
  }

  function updateTransition(dt) {
    if (app.transition.dir === 0) {
      return;
    }

    if (app.transition.dir === 1) {
      app.transition.alpha += app.transition.speed * dt;
      if (app.transition.alpha >= 1) {
        app.transition.alpha = 1;
        if (app.transition.pendingAction) {
          app.transition.pendingAction();
          app.transition.pendingAction = null;
        }
        app.transition.dir = -1;
      }
    } else {
      app.transition.alpha -= app.transition.speed * dt;
      if (app.transition.alpha <= 0) {
        app.transition.alpha = 0;
        app.transition.dir = 0;
      }
    }
  }

  function updateParticles(dt) {
    for (const particle of app.particles) {
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;

      if (particle.x > WIDTH + 10) {
        particle.x = -10;
      }
      if (particle.y < -10) {
        particle.y = HEIGHT + 10;
      }
      if (particle.y > HEIGHT + 10) {
        particle.y = -10;
      }
    }
  }

  function drawParticles(context) {
    context.save();
    for (const particle of app.particles) {
      context.fillStyle = "rgba(255, 255, 255, 0.35)";
      context.beginPath();
      context.arc(particle.x, particle.y, particle.r, 0, Math.PI * 2);
      context.fill();
    }
    context.restore();
  }

  function drawMenu(context) {
    context.save();

    context.fillStyle = "#c3e7ff";
    context.fillRect(0, 0, WIDTH, HEIGHT);
    drawParticles(context);

    context.fillStyle = "#14334a";
    context.font = "bold 66px Trebuchet MS";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText("Mini Olympics", WIDTH / 2, 120);

    context.font = "bold 24px Trebuchet MS";
    context.fillText("Choose an event", WIDTH / 2, 168);

    for (const button of app.ui.menuButtons) {
      Utils.drawButton(context, button);
    }

    context.font = "16px Trebuchet MS";
    context.fillStyle = "#1f4d6a";
    context.fillText("Controls: SPACE and arrows by event. Press M to toggle sound.", WIDTH / 2, 530);

    context.restore();
  }

  function drawHUD(context, hud) {
    context.save();

    context.fillStyle = "rgba(10, 31, 48, 0.75)";
    context.fillRect(0, 0, WIDTH, 52);

    context.fillStyle = "#ffffff";
    context.font = "bold 20px Trebuchet MS";
    context.textAlign = "left";
    context.textBaseline = "middle";
    context.fillText(hud.eventName, 14, 26);

    context.textAlign = "center";
    context.font = "bold 17px Trebuchet MS";
    context.fillText(`Attempts Remaining: ${Math.max(0, hud.attemptsRemaining)}`, WIDTH / 2, 26);

    context.textAlign = "right";
    context.font = "bold 20px Trebuchet MS";
    context.fillText(`Score: ${Math.round(hud.score)}`, WIDTH - 14, 26);

    context.fillStyle = "rgba(10, 31, 48, 0.72)";
    context.fillRect(0, HEIGHT - 42, WIDTH, 42);
    context.fillStyle = "#ffffff";
    context.textAlign = "left";
    context.font = "16px Trebuchet MS";
    context.fillText(hud.instructions, 14, HEIGHT - 20);

    context.restore();
  }

  function drawResults(context) {
    context.save();

    context.fillStyle = "#d3ecff";
    context.fillRect(0, 0, WIDTH, HEIGHT);
    drawParticles(context);

    context.fillStyle = "#173248";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.font = "bold 58px Trebuchet MS";
    context.fillText("Results", WIDTH / 2, 150);

    context.font = "bold 32px Trebuchet MS";
    context.fillText(app.results.eventName, WIDTH / 2, 250);

    context.font = "bold 48px Trebuchet MS";
    context.fillText(Utils.formatPoints(app.results.score), WIDTH / 2, 318);

    Utils.drawButton(context, app.ui.backButton);

    context.restore();
  }

  function drawTransition(context) {
    if (app.transition.alpha <= 0) {
      return;
    }

    context.save();
    context.fillStyle = `rgba(5, 14, 22, ${app.transition.alpha})`;
    context.fillRect(0, 0, WIDTH, HEIGHT);
    context.restore();
  }

  function getActiveButtons() {
    if (app.state === "menu") {
      return app.ui.menuButtons;
    }

    if (app.state === "results") {
      return [app.ui.backButton];
    }

    return [];
  }

  function routeInput(eventType, payload) {
    if (eventType === "keydown" && payload.code === "KeyM" && !payload.repeat) {
      Sound.toggle();
      Sound.beep({ freq: Sound.enabled ? 700 : 260, duration: 0.05, volume: 0.03 });
      return;
    }

    if (app.transition.dir !== 0) {
      return;
    }

    if (eventType === "pointermove") {
      const buttons = getActiveButtons();
      for (const button of buttons) {
        button.hover = Utils.pointInRect(payload.x, payload.y, button);
      }
      return;
    }

    if (eventType === "pointerdown") {
      const buttons = getActiveButtons();
      for (const button of buttons) {
        if (Utils.pointInRect(payload.x, payload.y, button)) {
          button.onClick();
          Sound.beep({ freq: 700, duration: 0.04, volume: 0.025 });
          break;
        }
      }
      return;
    }

    if (app.state === "event" && app.activeEvent) {
      app.activeEvent.handleInput(eventType, payload);
    }
  }

  function update(dt) {
    updateParticles(dt);

    if (app.state === "event" && app.activeEvent) {
      app.activeEvent.update(dt);

      if (app.activeEvent.finished) {
        const hud = app.activeEvent.getHUD();
        startTransition(() => {
          app.results.eventName = hud.eventName;
          app.results.score = hud.score;
          app.state = "results";
        });
      }
    }

    updateTransition(dt);
  }

  function draw() {
    ctx.clearRect(0, 0, WIDTH, HEIGHT);

    if (app.state === "menu") {
      drawMenu(ctx);
    } else if (app.state === "event" && app.activeEvent) {
      app.activeEvent.draw(ctx);
      drawHUD(ctx, app.activeEvent.getHUD());
    } else if (app.state === "results") {
      drawResults(ctx);
    }

    drawTransition(ctx);
  }

  let lastTime = 0;
  let accumulator = 0;

  function frame(timestamp) {
    if (!lastTime) {
      lastTime = timestamp;
    }

    let frameDelta = (timestamp - lastTime) / 1000;
    lastTime = timestamp;

    if (frameDelta > 0.25) {
      frameDelta = 0.25;
    }

    accumulator += frameDelta;

    // Fixed timestep accumulator keeps physics deterministic and stable.
    while (accumulator >= FIXED_DT) {
      update(FIXED_DT);
      accumulator -= FIXED_DT;
    }

    draw();
    requestAnimationFrame(frame);
  }

  soundToggleButton.addEventListener("click", () => {
    Sound.toggle();
    Sound.beep({ freq: Sound.enabled ? 700 : 260, duration: 0.05, volume: 0.03 });
  });

  initParticles();
  initUI();
  Input.init(routeInput);
  requestAnimationFrame(frame);
})();

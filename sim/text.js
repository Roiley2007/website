// Grasshollow — the language layer.
// Turns numeric world state into things the villagers actually say.

const pct = (v) => Math.max(0, Math.min(100, Math.round(v)));

export function needWord(key, v) {
  const scale = (labels) => labels[Math.min(labels.length - 1, Math.floor((100 - pct(v)) / (100 / labels.length)))];
  switch (key) {
    case 'hunger': return scale(['fed', 'peckish', 'hungry', 'very hungry', 'starving']);
    case 'thirst': return scale(['watered', 'dry-mouthed', 'thirsty', 'parched', 'desperate for water']);
    case 'energy': return scale(['rested', 'tiring', 'weary', 'exhausted', 'dead on his feet']);
    case 'social': return scale(['content', 'quiet', 'lonely', 'very lonely', 'aching for company']);
    case 'comfort': return scale(['comfortable', 'unsettled', 'uncomfortable', 'miserable', 'wretched']);
    case 'spirit': return scale(['hopeful', 'steady', 'low', 'despairing', 'hollowed out']);
    default: return '';
  }
}

// ---------------------------------------------------------------------------
// Prayers
// ---------------------------------------------------------------------------

const BODIES = {
  food: [
    'There is nothing left in the larder and nothing left in the granary. I have been {hunger} for {days}.',
    'The field has given what it is going to give, and it is not enough. We are eating memory at this point.',
    'I am asking for food. Plainly. Bread, grain, a field that yields — I do not care what shape it takes.',
  ],
  water: [
    'The well is down to mud. I have been {thirst} for {days} and I am rationing what is in the bucket.',
    'There is no water. Not in the well, not in the pond that I would trust. I am asking for water.',
    'I need the well to fill. That is the entire request. Water, in the well, that we can drink.',
  ],
  warmth: [
    'The house does not hold heat any more. I wake up {comfort} and I do not get warm again until noon.',
    'I am asking for warmth. Firewood, a blanket, a hearth that draws properly — something.',
    'It is cold in a way that has stopped being weather and started being a fact about my life.',
  ],
  shelter: [
    'The roof is going. When it rains I move the bed, and there is nowhere left to move it to.',
    'The house is coming apart faster than I can mend it with what I have.',
    'I am asking for the house to be made sound. I can do the work if there is anything to do it with.',
  ],
  rest: [
    'I cannot sleep properly and I have not for {days}. I am {energy} and it is making me stupid and slow.',
    'I am asking for rest. A bed that is not this bed. A night that is not this night.',
  ],
  company: [
    'I am {social}. That is not a complaint about anybody here, it is just the true state of things.',
    'I would like somebody to talk to who is not the well, or the wood, or myself.',
  ],
  spirit: [
    'I have gone {spirit} and I do not know how to get back on my own.',
    'Something in me has gone out. I am asking, without much confidence, for it to be lit again.',
  ],
  longing: [
    'I am asking for {longing}.',
    'What I want is {longing}. I have wanted it long enough that it has stopped feeling like wanting.',
    'This is the real one, the one underneath the others: {longing}.',
  ],
};

const MEMORY_LEADS = [
  'I keep thinking about this: ',
  'For what it is worth: ',
  'I remembered this on the way here: ',
  'This is in my head lately: ',
  'You should know this about me: ',
  'It sits with me: ',
];

/**
 * Compose a prayer. `ctx` supplies concrete facts so prayers stay grounded in
 * what is actually happening in the village rather than floating free.
 */
export function composePrayer(def, agent, desire, ctx, rng) {
  const opener = rng.pick(def.voice.opener);
  const closer = rng.pick(def.voice.closer);

  const key = desire.kind === 'longing' ? 'longing' : (BODIES[desire.kind] ? desire.kind : 'spirit');
  let body = rng.pick(BODIES[key]);

  const slots = {
    '{hunger}': needWord('hunger', agent.needs.hunger),
    '{thirst}': needWord('thirst', agent.needs.thirst),
    '{energy}': needWord('energy', agent.needs.energy),
    '{social}': needWord('social', agent.needs.social),
    '{comfort}': needWord('comfort', agent.needs.comfort),
    '{spirit}': needWord('spirit', agent.needs.spirit),
    '{days}': ctx.duration,
    '{longing}': desire.text ?? 'something I cannot name',
  };
  for (const [k, v] of Object.entries(slots)) body = body.split(k).join(v);

  const lines = [opener, body];

  // A high-weight memory surfaces about a third of the time, which is what
  // makes the prayers read as coming from someone with a past.
  if (rng.chance(0.38) && agent.memories.length) {
    const candidates = agent.memories.filter((m) => m.kind !== 'prayer');
    const strong = candidates.filter((m) => m.weight >= 7);
    const pool = strong.length ? strong : (candidates.length ? candidates : agent.memories);
    const m = rng.pick(pool);
    lines.push(rng.pick(MEMORY_LEADS) + m.text);
  }

  if (ctx.previouslyAsked > 0) {
    lines.push(
      ctx.previouslyAsked === 1
        ? 'I have asked you this once before.'
        : `I have asked you this ${ctx.previouslyAsked} times before.`
    );
  }

  lines.push(closer);
  return lines.join('\n\n');
}

/** Short label for the prayer feed. */
export function prayerTitle(desire, self = false) {
  const titles = {
    food: 'for food', water: 'for water', warmth: 'for warmth',
    shelter: 'for a sound roof', rest: 'for rest', company: 'for company',
    spirit: 'to be lifted',
  };
  if (desire.kind === 'longing') {
    return (self ? desire.selfTitle : desire.shortText) ?? desire.shortText ?? 'for something long-wanted';
  }
  return titles[desire.kind] ?? 'for help';
}

// ---------------------------------------------------------------------------
// Thoughts — the one-liner shown under each agent in the viewer.
// ---------------------------------------------------------------------------

const THOUGHTS = {
  sleep: ['Sleeping.', 'Dreaming about nothing in particular.', 'Down for the night.'],
  eat: ['Eating.', 'Bread and whatever else there is.', 'A meal, finally.'],
  drink: ['Drinking at the well.', 'Cold water. Good water.', 'Filling the bucket.'],
  work_field: ['Working the field.', 'Turning the eastern rows.', 'Bent over the furrows.'],
  work_woods: ['Cutting wood.', 'Splitting logs badly but fast.', 'Hauling deadfall out of the trees.'],
  work_well: ['Tending the well.', 'Clearing the well of leaves.', 'Checking the water, writing it down.'],
  socialise: ['Talking with {other}.', 'Sat with {other} at the square.', 'Trading news with {other}.'],
  socialise_alone: ['Waiting at the square for anyone.', 'Nobody about. Waiting anyway.', 'Sat on the well wall, alone.'],
  pray: ['Kneeling at the temple.', 'Praying.', 'Saying it out loud, in case that matters.'],
  fetch: ['Fetching food from the granary.', 'Hauling grain home.'],
  travel: ['Walking.', 'On the path.', 'Heading over.'],
  forage: ['Foraging along the hedgerows.', 'Looking for anything edible in the wood.', 'Berries, roots, whatever there is.'],
  mend: ['Mending the roof.', 'Patching the wall with what there is.', 'Working on the house.'],
  hearth: ['Sat by the fire.', 'Warming through by the hearth.', 'Home, and not moving for a bit.'],
  rest: ['Resting.', 'Sitting a while.', 'Taking the weight off.'],
  idle: ['Standing about.', 'Watching the weather.', 'Doing not much.'],
  wander: ['Walking the long way round.', 'Stretching his legs.', 'Wandering.'],
};

const URGENT = [
  { key: 'thirst', at: 22, line: 'Very thirsty. The well is on my mind.' },
  { key: 'hunger', at: 22, line: 'Hungry enough that it is hard to think about anything else.' },
  { key: 'energy', at: 20, line: 'Exhausted.' },
  { key: 'comfort', at: 20, line: 'Cold and sore and wanting the day to end.' },
  { key: 'spirit', at: 20, line: 'Low. Hard to see the point of the next bit.' },
  { key: 'social', at: 20, line: 'Lonely.' },
];

export function composeThought(agent, rng) {
  for (const u of URGENT) {
    if (agent.needs[u.key] < u.at && rng.chance(0.55)) return u.line;
  }
  const a = agent.action;
  if (!a) return rng.pick(THOUGHTS.idle);
  if (a.phase === 'travel') return rng.pick(THOUGHTS.travel);
  let key = a.thoughtKey ?? a.kind;
  if (key === 'socialise' && !a.meta?.otherName) key = 'socialise_alone';
  const pool = THOUGHTS[key] ?? THOUGHTS.idle;
  let line = rng.pick(pool);
  if (a.meta?.otherName) line = line.split('{other}').join(a.meta.otherName);
  return line;
}

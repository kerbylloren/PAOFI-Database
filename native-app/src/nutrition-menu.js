function text(value) {
  return value === null || typeof value === "undefined" ? "" : String(value).trim();
}

function amount(value) {
  const number = Number(text(value).replace(/[^\d.-]/g, ""));
  return Number.isFinite(number) ? Number(number.toFixed(2)) : 0;
}

function positiveNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

const WHOLE_PURCHASE_UNITS = /\b(?:pc|pcs|piece|pieces|pack|packs|packet|packets|pkt|pkts|sachet|sachets|bottle|bottles|bot|bots|bt|bts|btl|btls|bote|botes|can|cans|tin|tins|lata|latas|tali|talis|tanda|tandas|tumpok|tumpoks|bundle|bundles|bunch|bunches|head|heads|tray|trays|box|boxes|pouch|pouches|bag|bags|jar|jars|tub|tubs|block|blocks|loaf|loaves|roll|rolls|stick|sticks|cube|cubes|bar|bars|set|sets|supot|supots|balot|balots)\b/i;
const COUNTABLE_INGREDIENTS = /\b(?:egg|eggs|itlog|hotdog|hotdogs|sausage|sausages)\b/i;
const PACKAGED_INGREDIENTS = /\b(?:century\s*tuna|corn\s*beef|cornbeef|sardine|sardines|sardinas|corn\s*in\s*can|mushroom|evaporated\s*milk|condensed\s*milk|gata|coconut\s*milk|tomato\s*sauce|caldereta\s*sauce|ketchup|catsup|toyo|soy\s*sauce|suka|vinegar|patis|fish\s*sauce|oyster\s*sauce|crispy\s*fry|seasoning|magic\s*sarap|knorr|bouillon|cornstarch|bread\s*crumbs|curry\s*powder|lumpia\s*wrapper|miswa|noodles|sotanghon|macaroni)\b/i;
const WHOLE_STAPLE_INGREDIENTS = /\b(?:bawang|garlic|sibuyas|onion|onions|luya|ginger|mantika|oil|seasoning|seasonings)\b/i;

function parsePurchaseQuantity(value) {
  const source = text(value);
  if (!source) return null;
  const mixed = /^(\d+)\s+(\d+)\/(\d+)(.*)$/.exec(source);
  if (mixed && Number(mixed[3])) {
    return {
      source,
      quantity: Number(mixed[1]) + (Number(mixed[2]) / Number(mixed[3])),
      suffix: mixed[4]
    };
  }
  const fraction = /^(\d+)\/(\d+)(.*)$/.exec(source);
  if (fraction && Number(fraction[2])) {
    return {
      source,
      quantity: Number(fraction[1]) / Number(fraction[2]),
      suffix: fraction[3]
    };
  }
  const decimal = /^(-?(?:\d[\d,]*(?:\.\d+)?|\.\d+))(.*)$/.exec(source);
  if (!decimal) return null;
  const quantity = Number(decimal[1].replaceAll(",", ""));
  return Number.isFinite(quantity) ? { source, quantity, suffix: decimal[2] } : null;
}

function purchaseIncrement(ingredientName, suffix) {
  const unit = text(suffix).toLowerCase().replace(/[^a-z\s]/g, " ").replace(/\s+/g, " ");
  if (WHOLE_STAPLE_INGREDIENTS.test(text(ingredientName))) return 1;
  if (WHOLE_PURCHASE_UNITS.test(unit)) return 1;
  if (/\b(?:kg|kgs|kilo|kilos|kilogram|kilograms)\b/.test(unit)) return 0.25;
  if (/\b(?:g|gram|grams)\b/.test(unit)) return 50;
  if (/\b(?:l|ltr|ltrs|liter|liters|litre|litres)\b/.test(unit)) return 0.25;
  if (/\b(?:ml|milliliter|milliliters|millilitre|millilitres)\b/.test(unit)) return 50;
  if (/\b(?:dozen|dozens)\b/.test(unit)) return 0.5;
  if (!unit && (COUNTABLE_INGREDIENTS.test(text(ingredientName)) || PACKAGED_INGREDIENTS.test(text(ingredientName)))) return 1;
  if (!unit) return 0.25;
  return 0.01;
}

function budgetCostIncrement(ingredientName) {
  return WHOLE_STAPLE_INGREDIENTS.test(text(ingredientName)) ? 5 : 0.01;
}

function ceilToIncrement(value, increment) {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Number((Math.ceil((value - 1e-9) / increment) * increment).toFixed(2));
}

function formatPurchaseQuantity(quantity, suffix) {
  const formatted = Number(quantity.toFixed(2)).toString();
  return `${formatted}${suffix}`;
}

function scalePurchaseBudget({ ingredientName = "", quantity = "", cost = 0, factor = 1 } = {}) {
  const source = parsePurchaseQuantity(quantity);
  const scale = Number(factor);
  const defaultCost = amount(cost);
  if (!source || !Number.isFinite(scale) || scale <= 0 || source.quantity <= 0) {
    const scaledCost = defaultCost * (Number.isFinite(scale) && scale > 0 ? scale : 1);
    return {
      quantity: text(quantity),
      cost: ceilToIncrement(scaledCost, budgetCostIncrement(ingredientName))
    };
  }
  const roundedQuantity = ceilToIncrement(
    source.quantity * scale,
    purchaseIncrement(ingredientName, source.suffix)
  );
  return {
    quantity: formatPurchaseQuantity(roundedQuantity, source.suffix),
    cost: ceilToIncrement(
      defaultCost * (roundedQuantity / source.quantity),
      budgetCostIncrement(ingredientName)
    )
  };
}

function scaleQuantity(value, factor = 1, ingredientName = "") {
  return scalePurchaseBudget({ ingredientName, quantity: value, factor }).quantity;
}

function recipeKey(value) {
  return text(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function isoDate(value) {
  const source = text(value);
  if (!source) return "";
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(source);
  if (iso) return source;
  const slash = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(source);
  if (!slash) return "";
  return `${slash[3]}-${slash[1].padStart(2, "0")}-${slash[2].padStart(2, "0")}`;
}

function monthKey(value) {
  const source = text(value);
  const match = /^(\d{4})-(\d{1,2})/.exec(source);
  if (!match) return "";
  const month = Number(match[2]);
  return month >= 1 && month <= 12 ? `${match[1]}-${String(month).padStart(2, "0")}` : "";
}

function addDays(value, days) {
  const date = new Date(`${isoDate(value)}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return "";
  date.setUTCDate(date.getUTCDate() + Number(days || 0));
  return date.toISOString().slice(0, 10);
}

function weekStart(value) {
  const date = new Date(`${isoDate(value)}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return "";
  const weekday = date.getUTCDay();
  const distance = weekday === 0 ? -6 : 1 - weekday;
  return addDays(isoDate(value), distance);
}

function normalizeRecipeIngredient(input = {}, rowOrder = 0) {
  return {
    id: Number(input.id || 0) || 0,
    ingredient_name: text(input.ingredient_name || input.ingredientName),
    default_quantity: text(input.default_quantity ?? input.defaultQuantity),
    default_cost: amount(input.default_cost ?? input.defaultCost),
    row_order: Number(input.row_order ?? input.rowOrder ?? rowOrder) || 0
  };
}

function normalizeRecipe(input = {}, existing = null) {
  const ingredients = (Array.isArray(input.ingredients) ? input.ingredients : existing?.ingredients || [])
    .map(normalizeRecipeIngredient)
    .filter(item => item.ingredient_name || item.default_quantity || item.default_cost)
    .map((item, index) => ({ ...item, row_order: index }));
  const recipeName = text(input.recipe_name || input.recipeName || existing?.recipe_name);
  return {
    id: Number(input.id || existing?.id || 0) || 0,
    recipe_name: recipeName,
    recipe_key: recipeKey(recipeName),
    description: text(input.description || existing?.description),
    base_servings: Math.max(Math.round(positiveNumber(input.base_servings ?? input.baseServings ?? existing?.base_servings, 0)), 0),
    status: text(input.status || existing?.status || "Active") || "Active",
    ingredients
  };
}

function decorateRecipe(recipe = {}, ingredients = null) {
  const prepared = Array.isArray(ingredients)
    ? ingredients.map(normalizeRecipeIngredient)
    : null;
  const ingredientCount = Number(recipe.ingredient_count ?? prepared?.length ?? 0);
  const budgetCost = prepared
    ? prepared.reduce((sum, item) => sum + item.default_cost, 0)
    : amount(recipe.budget_cost);
  return {
    ...recipe,
    base_servings: Number(recipe.base_servings || 0),
    ingredient_count: ingredientCount,
    budget_cost: Number(budgetCost.toFixed(2)),
    ...(prepared ? { ingredients: prepared } : {})
  };
}

function normalizeMenuEntry(input = {}, rowOrder = 0) {
  const mealDate = isoDate(input.meal_date || input.mealDate || input.date);
  return {
    id: Number(input.id || 0) || 0,
    meal_date: mealDate,
    recipe_id: Number(input.recipe_id || input.recipeId || 0) || null,
    meal_name: text(input.meal_name || input.mealName || input.recipe_name),
    notes: text(input.notes),
    row_order: Number(input.row_order ?? input.rowOrder ?? rowOrder) || 0
  };
}

function normalizeMenu(input = {}, existing = null) {
  const menuMonth = monthKey(input.menu_month || input.menuMonth || existing?.menu_month);
  const entries = (Array.isArray(input.entries) ? input.entries : existing?.entries || [])
    .map(normalizeMenuEntry)
    .filter(entry => entry.meal_date && entry.meal_name)
    .sort((left, right) => left.meal_date.localeCompare(right.meal_date))
    .map((entry, index) => ({ ...entry, row_order: index }));
  return {
    id: Number(input.id || existing?.id || 0) || 0,
    menu_month: menuMonth,
    status: text(input.status || existing?.status || "Draft") || "Draft",
    notes: text(input.notes || existing?.notes),
    entries
  };
}

function groupMenuEntriesByWeek(entries = []) {
  const groups = new Map();
  entries.forEach(entry => {
    const start = weekStart(entry.meal_date);
    if (!start) return;
    if (!groups.has(start)) groups.set(start, []);
    groups.get(start).push(entry);
  });
  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([start, items]) => ({
      week_start: start,
      week_end: addDays(start, 4),
      entries: items.sort((left, right) => left.meal_date.localeCompare(right.meal_date))
    }));
}

function normalizeCostingItem(input = {}, rowOrder = 0) {
  return {
    id: Number(input.id || 0) || 0,
    recipe_ingredient_id: Number(input.recipe_ingredient_id || input.recipeIngredientId || 0) || null,
    ingredient_name: text(input.ingredient_name || input.ingredientName),
    budget_quantity: text(input.budget_quantity ?? input.budgetQuantity),
    budget_cost: amount(input.budget_cost ?? input.budgetCost),
    actual_quantity: text(input.actual_quantity ?? input.actualQuantity),
    actual_cost: amount(input.actual_cost ?? input.actualCost),
    row_order: Number(input.row_order ?? input.rowOrder ?? rowOrder) || 0
  };
}

function normalizeCostingDay(input = {}, rowOrder = 0) {
  const items = (Array.isArray(input.items) ? input.items : [])
    .map(normalizeCostingItem)
    .filter(item => item.ingredient_name || item.budget_quantity || item.budget_cost || item.actual_quantity || item.actual_cost)
    .map((item, index) => ({ ...item, row_order: index }));
  return {
    id: Number(input.id || 0) || 0,
    meal_date: isoDate(input.meal_date || input.mealDate),
    recipe_id: Number(input.recipe_id || input.recipeId || 0) || null,
    meal_name: text(input.meal_name || input.mealName),
    kids_present: Math.max(Math.round(positiveNumber(input.kids_present ?? input.kidsPresent, 0)), 0),
    row_order: Number(input.row_order ?? input.rowOrder ?? rowOrder) || 0,
    items
  };
}

function decorateCosting(costing = {}, days = null) {
  const preparedDays = Array.isArray(days)
    ? days.map(normalizeCostingDay).map((day, index) => ({ ...day, row_order: index }))
    : null;
  const budgetFoodTotal = preparedDays
    ? preparedDays.reduce((sum, day) => sum + day.items.reduce((daySum, item) => daySum + item.budget_cost, 0), 0)
    : amount(costing.budget_food_total);
  const actualFoodTotal = preparedDays
    ? preparedDays.reduce((sum, day) => sum + day.items.reduce((daySum, item) => daySum + item.actual_cost, 0), 0)
    : amount(costing.actual_food_total);
  const budgetReleased = amount(costing.budget_released);
  return {
    ...costing,
    no_children: Number(costing.no_children || 0),
    inventory_rice: Number(costing.inventory_rice || 0),
    inventory_manna: Number(costing.inventory_manna || 0),
    inventory_vitameals: Number(costing.inventory_vitameals || 0),
    budget_released: budgetReleased,
    budget_food_total: Number(budgetFoodTotal.toFixed(2)),
    actual_food_total: Number(actualFoodTotal.toFixed(2)),
    budget_balance: Number((budgetReleased - budgetFoodTotal).toFixed(2)),
    actual_balance: Number((budgetReleased - actualFoodTotal).toFixed(2)),
    day_count: Number(costing.day_count ?? preparedDays?.length ?? 0),
    ...(preparedDays ? { days: preparedDays } : {})
  };
}

function normalizeCosting(input = {}, existing = null) {
  const days = (Array.isArray(input.days) ? input.days : existing?.days || [])
    .map(normalizeCostingDay)
    .filter(day => day.meal_date || day.meal_name || day.items.length)
    .sort((left, right) => left.meal_date.localeCompare(right.meal_date))
    .map((day, index) => ({ ...day, row_order: index }));
  const start = isoDate(input.week_start || input.weekStart || existing?.week_start || days[0]?.meal_date);
  return {
    id: Number(input.id || existing?.id || 0) || 0,
    center_id: Number(input.center_id || input.centerId || existing?.center_id || 0) || 0,
    center_name: text(input.center_name || input.centerName || existing?.center_name),
    menu_id: Number(input.menu_id || input.menuId || existing?.menu_id || 0) || null,
    report_month: monthKey(input.report_month || input.reportMonth || existing?.report_month || start),
    week_start: start,
    week_end: isoDate(input.week_end || input.weekEnd || existing?.week_end) || addDays(start, 4),
    no_children: Math.max(Math.round(positiveNumber(input.no_children ?? input.noChildren ?? existing?.no_children, 0)), 0),
    inventory_rice: positiveNumber(input.inventory_rice ?? input.inventoryRice ?? existing?.inventory_rice, 0),
    inventory_manna: positiveNumber(input.inventory_manna ?? input.inventoryManna ?? existing?.inventory_manna, 0),
    inventory_vitameals: positiveNumber(input.inventory_vitameals ?? input.inventoryVitameals ?? existing?.inventory_vitameals, 0),
    budget_released: amount(input.budget_released ?? input.budgetReleased ?? existing?.budget_released),
    status: text(input.status || existing?.status || "Draft") || "Draft",
    notes: text(input.notes || existing?.notes),
    days
  };
}

module.exports = {
  addDays,
  amount,
  decorateCosting,
  decorateRecipe,
  groupMenuEntriesByWeek,
  isoDate,
  monthKey,
  normalizeCosting,
  normalizeCostingDay,
  normalizeCostingItem,
  normalizeMenu,
  normalizeMenuEntry,
  normalizeRecipe,
  normalizeRecipeIngredient,
  recipeKey,
  scalePurchaseBudget,
  scaleQuantity,
  weekStart
};

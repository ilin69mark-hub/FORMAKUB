"use client";

import {
  BODY_MATERIALS,
  COUNTERTOPS,
  FACADE_MATERIALS,
  FACADE_STYLES,
  HANDLES,
  snapCountertopThickness,
} from "@/content/catalog";
import {
  LED_COLOR_TEMPS,
  LED_CONTROLS,
  LED_DIFFUSERS,
  LED_POWERS,
  LED_PROFILES,
  LED_VOLTAGES,
  ledColorHex,
} from "@/content/lighting";
import { PLINTH_MATERIALS, findPlinthMaterial, plinthRatePerMeter } from "@/content/plinth";
import { PLINTH_MOUNTS, findSupportSystem } from "@/content/supports";
import { computeLighting } from "@/lib/configurator/lighting";
import { formatRub, kitchenFloorModules } from "@/lib/configurator/pricing";
import { computeSupports } from "@/lib/configurator/supports";
import type {
  FurnitureConfig,
  HandleType,
  KitchenConfig,
  WardrobeConfig,
} from "@/lib/configurator/types";
import { Power } from "lucide-react";
import {
  ChoiceCard,
  PanelSection,
  RangeField,
  SwatchField,
  SwitchRow,
} from "./ui";

/** Компактный ряд вариантов (напряжение, мощность, температура цвета). */
function ChipGroup({
  title,
  items,
  value,
  onPick,
}: {
  title: string;
  items: { id: number | string; label: string; dot?: string }[];
  value: number | string;
  onPick: (id: number | string) => void;
}) {
  return (
    <div>
      <div className="text-[0.6rem] font-bold uppercase tracking-[0.14em] text-ink/40">
        {title}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {items.map((item) => {
          const active = item.id === value;
          return (
            <button
              key={item.id}
              type="button"
              aria-pressed={active}
              onClick={() => onPick(item.id)}
              className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[0.6rem] font-semibold transition-colors ${
                active
                  ? "border-copper bg-copper/10 text-copper"
                  : "border-ink/10 bg-white/40 text-ink/55 hover:bg-white/70"
              }`}
            >
              {item.dot ? (
                <span
                  className="h-2.5 w-2.5 rounded-full ring-1 ring-ink/10"
                  style={{ background: item.dot }}
                />
              ) : null}
              {item.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function MaterialsPanel({
  config,
  onChange,
}: {
  config: FurnitureConfig;
  onChange: (next: FurnitureConfig) => void;
}) {
  const body = BODY_MATERIALS.find((item) => item.id === config.bodyMaterial) ?? BODY_MATERIALS[0];
  const facade =
    FACADE_MATERIALS.find((item) => item.id === config.facadeMaterial) ?? FACADE_MATERIALS[0];

  return (
    <div className="space-y-5">
      <PanelSection title="Корпус" hint="Материал влияет на прочность, вес и стоимость основы.">
        <div className="grid grid-cols-3 gap-1.5">
          {BODY_MATERIALS.map((material) => (
            <ChoiceCard
              key={material.id}
              title={material.name}
              meta={material.ratePerSqm ? `${formatRub(material.ratePerSqm)}/м²` : undefined}
              selected={config.bodyMaterial === material.id}
              onClick={() =>
                onChange({
                  ...config,
                  bodyMaterial: material.id,
                  bodyFinish: material.finishes[0].id,
                })
              }
            />
          ))}
        </div>
        <p className="mt-2 text-[0.62rem] leading-relaxed text-ink/42">{body.description}</p>
        <div className="mt-3">
          <SwatchField
            label="Цвет корпуса"
            finishes={body.finishes}
            value={config.bodyFinish}
            onChange={(id) => onChange({ ...config, bodyFinish: id })}
          />
        </div>
      </PanelSection>

      <PanelSection title="Фасады" hint="Материал, покрытие и геометрия фронта.">
        <div className="grid grid-cols-2 gap-1.5">
          {FACADE_MATERIALS.map((material) => (
            <ChoiceCard
              key={material.id}
              title={material.name}
              meta={material.ratePerSqm ? `${formatRub(material.ratePerSqm)}/м²` : undefined}
              selected={config.facadeMaterial === material.id}
              onClick={() => {
                const style =
                  material.id === "glass" && config.facadeStyle === "shaker"
                    ? "flat"
                    : config.facadeStyle;
                onChange({
                  ...config,
                  facadeMaterial: material.id,
                  facadeFinish: material.finishes[0].id,
                  facadeStyle: style,
                });
              }}
            />
          ))}
        </div>
        <p className="mt-2 text-[0.62rem] leading-relaxed text-ink/42">{facade.description}</p>
        <div className="mt-3">
          <SwatchField
            label="Покрытие фасада"
            finishes={facade.finishes}
            value={config.facadeFinish}
            onChange={(id) => onChange({ ...config, facadeFinish: id })}
          />
        </div>

        <div className="mt-4">
          <div className="text-[0.66rem] font-medium text-ink/50">Геометрия фасада</div>
          <div className="mt-2 grid gap-1.5">
            {FACADE_STYLES.map((style) => (
              <ChoiceCard
                key={style.id}
                title={style.name}
                description={style.description}
                meta={style.multiplier > 1 ? `×${style.multiplier}` : undefined}
                selected={config.facadeStyle === style.id}
                disabled={style.id === "shaker" && config.facadeMaterial === "glass"}
                onClick={() => {
                  const handle: HandleType =
                    style.id === "handleless" &&
                    (config.handle === "bar" || config.handle === "knob")
                      ? "profile"
                      : config.handle;
                  onChange({ ...config, facadeStyle: style.id, handle });
                }}
              />
            ))}
          </div>
          {config.facadeMaterial === "glass" && (
            <p className="mt-2 text-[0.6rem] leading-relaxed text-copper">
              Для стекла в демо-конфигураторе доступны ровный и безручечный фасад.
            </p>
          )}
        </div>
      </PanelSection>
    </div>
  );
}

export function FittingsPanel({
  config,
  onChange,
}: {
  config: FurnitureConfig;
  onChange: (next: FurnitureConfig) => void;
}) {
  return (
    <div className="space-y-5">
      <PanelSection title="Ручки" hint="Выступающие ручки несовместимы с push-to-open.">
        <div className="grid grid-cols-2 gap-1.5">
          {HANDLES.map((handle) => (
            <ChoiceCard
              key={handle.id}
              title={handle.name}
              meta={handle.rate > 0 ? `${formatRub(handle.rate)}/шт.` : "0 ₽"}
              selected={config.handle === handle.id}
              onClick={() => {
                const style =
                  (handle.id === "bar" || handle.id === "knob") &&
                  config.facadeStyle === "handleless"
                    ? "flat"
                    : config.facadeStyle;
                onChange({
                  ...config,
                  handle: handle.id,
                  facadeStyle: style,
                  pushToOpen: handle.id === "none" ? true : config.pushToOpen,
                });
              }}
            />
          ))}
        </div>
        <p className="mt-2 text-[0.62rem] leading-relaxed text-ink/42">
          {HANDLES.find((item) => item.id === config.handle)?.description}
        </p>
      </PanelSection>

      <PanelSection title="Петли" hint="Доводчик снижает шум и продлевает ресурс петель.">
        <div className="grid grid-cols-2 gap-1.5">
          <ChoiceCard
            title="Стандартные"
            description="Базовая петля без доводчика."
            selected={config.hinge === "standard"}
            onClick={() => onChange({ ...config, hinge: "standard" })}
          />
          <ChoiceCard
            title="С доводчиком"
            description="Плавное закрывание фасада."
            meta="+"
            selected={config.hinge === "soft"}
            onClick={() => onChange({ ...config, hinge: "soft" })}
          />
        </div>
      </PanelSection>

      <PanelSection title="Открывание" hint="Push-to-open работает только без выступающих ручек.">
        <SwitchRow
          title="Push-to-open"
          description={
            config.handle === "none"
              ? "Фасад открывается нажатием. Стоимость добавлена в фурнитуру."
              : "При включении ручка переключится на «Без ручек»."
          }
          checked={config.pushToOpen}
          onChange={(checked) =>
            onChange({
              ...config,
              pushToOpen: checked,
              handle: checked ? "none" : config.handle === "none" ? "profile" : config.handle,
            })
          }
        />
        <div className="mt-3 rounded-lg border border-ink/8 bg-white/35 px-3 py-2 text-[0.6rem] leading-relaxed text-ink/42">
          В демо-конфигураторе push-to-open и накладная ручка взаимоисключающие.
          При смене ручки конфликт снимается автоматически.
        </div>
      </PanelSection>
    </div>
  );
}

export function KitchenOptionsPanel({
  config,
  onChange,
}: {
  config: KitchenConfig;
  onChange: (next: KitchenConfig) => void;
}) {
  const countertop =
    COUNTERTOPS.find((item) => item.id === config.countertop) ?? COUNTERTOPS[0];

  const floorWidthCm = kitchenFloorModules(config).reduce(
    (sum, module) => sum + module.width,
    0,
  );
  const plinthOption =
    findPlinthMaterial(config.plinthMaterial) ?? PLINTH_MATERIALS[0];
  const plinthRate = plinthRatePerMeter(
    config.plinthMaterial ?? "",
    config.plinthFinish ?? "",
  );
  // Единый расчёт опор для панели, 2D-схемы, спецификации и цены.
  const supports = computeSupports(config);
  const supportSystem = findSupportSystem(supports.systemId);
  const lighting = computeLighting(config);

  return (
    <div className="space-y-5">
      <PanelSection title="Столешница" hint="Считается по длине нижнего ряда. Мойка и варочная зона уже учтены в модулях.">
        <div className="grid grid-cols-2 gap-1.5">
          {COUNTERTOPS.map((item) => (
            <ChoiceCard
              key={item.id}
              title={item.name}
              meta={
                item.ratePerLinearMeter
                  ? `${formatRub(item.ratePerLinearMeter)}/м`
                  : undefined
              }
              selected={config.countertop === item.id}
              onClick={() =>
                onChange({
                  ...config,
                  countertop: item.id,
                  countertopThickness: item.defaultThickness,
                })
              }
            />
          ))}
        </div>
        <p className="mt-2 text-[0.62rem] leading-relaxed text-ink/42">{countertop.description}</p>
        <div className="mt-3">
          <div className="text-[0.6rem] font-bold uppercase tracking-[0.14em] text-ink/40">
            Толщина столешницы
          </div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {countertop.thicknesses.map((value) => {
              const active =
                snapCountertopThickness(config.countertop, config.countertopThickness) === value;
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() =>
                    onChange({
                      ...config,
                      countertopThickness: snapCountertopThickness(config.countertop, value),
                    })
                  }
                  className={`rounded-full border px-2.5 py-1 text-[0.6rem] font-semibold transition-colors ${
                    active
                      ? "border-copper bg-copper/10 text-copper"
                      : "border-ink/10 bg-white/40 text-ink/55 hover:bg-white/70"
                  }`}
                >
                  {value} мм
                </button>
              );
            })}
          </div>
        </div>
        <div className="mt-2 flex items-center gap-2 text-[0.6rem] text-ink/38">
          <span
            className="h-4 w-4 rounded-full border border-ink/10"
            style={{ background: countertop.finishes[0]?.hex }}
          />
          В демо-версии используется базовый декор: {countertop.finishes[0]?.name}.
        </div>
      </PanelSection>

      <PanelSection
        title="Опции кухни"
        hint="Цоколь, подсветка верхнего ряда и опоры считаются по выбранным материалам и характеристикам."
      >
        <div className="space-y-2">
          <SwitchRow
            title="Цоколь"
            description="Единый цоколь по длине нижнего ряда."
            checked={config.plinth}
            onChange={(checked) => onChange({ ...config, plinth: checked })}
          />
        </div>

        {config.plinth && (
          <div className="mt-3 space-y-3">
            <div>
              <div className="text-[0.6rem] font-bold uppercase tracking-[0.14em] text-ink/40">
                Материал цоколя
              </div>
              <div className="mt-1.5 grid grid-cols-2 gap-1.5">
                {PLINTH_MATERIALS.map((material) => (
                  <ChoiceCard
                    key={material.id}
                    title={material.name}
                    meta={`${material.ratePerMeter} ₽/м`}
                    selected={config.plinthMaterial === material.id}
                    onClick={() =>
                      onChange({
                        ...config,
                        plinthMaterial: material.id,
                        plinthThickness: material.defaultThickness,
                        plinthFinish: material.finishes[0].id,
                      })
                    }
                  />
                ))}
              </div>
            </div>

            <div>
              <div className="text-[0.6rem] font-bold uppercase tracking-[0.14em] text-ink/40">
                Толщина
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {plinthOption.thicknesses.map((value) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={config.plinthThickness === value}
                    onClick={() => onChange({ ...config, plinthThickness: value })}
                    className={`rounded-full border px-2.5 py-1 text-[0.6rem] font-semibold transition-colors ${
                      config.plinthThickness === value
                        ? "border-copper bg-copper/10 text-copper"
                        : "border-ink/10 bg-white/40 text-ink/55 hover:bg-white/70"
                    }`}
                  >
                    {value} мм
                  </button>
                ))}
              </div>
            </div>

            <ChipGroup
              title="Исполнение"
              items={plinthOption.finishes.map((finish) => ({
                id: finish.id,
                label: finish.name,
              }))}
              value={config.plinthFinish}
              onPick={(id) => onChange({ ...config, plinthFinish: String(id) })}
            />

            <div>
              <div className="text-[0.6rem] font-bold uppercase tracking-[0.14em] text-ink/40">
                Крепление к опорам
              </div>
              <div className="mt-1.5 grid grid-cols-2 gap-1.5">
                {PLINTH_MOUNTS.map((mount) => (
                  <ChoiceCard
                    key={mount.id}
                    title={mount.label}
                    description={mount.description}
                    selected={config.plinthMount === mount.id}
                    onClick={() => onChange({ ...config, plinthMount: mount.id })}
                  />
                ))}
              </div>
            </div>

            <div className="rounded-lg border border-ink/8 bg-white/35 px-3 py-2 text-[0.6rem] leading-relaxed text-ink/45">
              {(floorWidthCm / 100).toFixed(1)} м · {formatRub(plinthRate)}/м ·{" "}
              {formatRub((floorWidthCm / 100) * plinthRate)}
              <span className="block text-ink/38">
                {config.plinthMount === "clips"
                  ? `Клипс: ${supports.clips} шт. по ${supportSystem.clipsPerLeg} на переднюю опору.`
                  : `Винтов скрытого крепления: ${supports.screws} шт.`}
              </span>
            </div>
          </div>
        )}

        <div className="mt-3 space-y-2">
          <SwitchRow
            title="Подсветка верхнего ряда"
            description={
              config.underCabinetLighting
                ? `Включено · ${lighting.lengthM} м · ${lighting.powerW} Вт`
                : "Светодиодная лента под верхними шкафами."
            }
            checked={config.underCabinetLighting}
            onChange={(checked) => onChange({ ...config, underCabinetLighting: checked })}
          />
          {config.underCabinetLighting && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                aria-pressed={config.underCabinetLighting}
                aria-label={
                  config.underCabinetLighting
                    ? "Выключить подсветку"
                    : "Включить подсветку"
                }
                onClick={() =>
                  onChange({ ...config, underCabinetLighting: !config.underCabinetLighting })
                }
                className={`flex h-8 w-8 items-center justify-center rounded-full border transition-colors ${
                  config.underCabinetLighting
                    ? "border-copper bg-copper/15 text-copper"
                    : "border-ink/12 bg-white/50 text-ink/40 hover:bg-white"
                }`}
              >
                <Power size={15} />
              </button>
              <span
                className="h-7 w-7 rounded-full ring-1 ring-ink/10"
                style={{ background: lighting.hex }}
                aria-hidden="true"
              />
              <span className="text-[0.6rem] leading-relaxed text-ink/45">
                {lighting.colorTemp} K · {lighting.voltage} В ·{" "}
                {lighting.powerPerMeter} Вт/м
              </span>
            </div>
          )}
        </div>

        {config.underCabinetLighting && (
          <div className="mt-3 space-y-3">
            <ChipGroup
              title="Напряжение"
              items={LED_VOLTAGES.map((value) => ({ id: value, label: `${value} В` }))}
              value={config.lighting.voltage}
              onPick={(id) =>
                onChange({
                  ...config,
                  lighting: { ...config.lighting, voltage: id as 12 | 24 },
                })
              }
            />
            <ChipGroup
              title="Мощность"
              items={LED_POWERS.map((value) => ({
                id: value,
                label: `${value} Вт/м`,
              }))}
              value={config.lighting.powerPerMeter}
              onPick={(id) =>
                onChange({
                  ...config,
                  lighting: {
                    ...config.lighting,
                    powerPerMeter: id as 4.8 | 9.6 | 14.4 | 19.2,
                  },
                })
              }
            />
            <ChipGroup
              title="Цветовая температура"
              items={LED_COLOR_TEMPS.map((value) => ({
                id: value,
                label: `${value} K`,
                dot: ledColorHex(value),
              }))}
              value={config.lighting.colorTemp}
              onPick={(id) =>
                onChange({
                  ...config,
                  lighting: {
                    ...config.lighting,
                    colorTemp: id as 2700 | 3000 | 4000 | 5000 | 6000,
                  },
                })
              }
            />

            <div>
              <div className="text-[0.6rem] font-bold uppercase tracking-[0.14em] text-ink/40">
                Профиль
              </div>
              <div className="mt-1.5 grid grid-cols-3 gap-1.5">
                {LED_PROFILES.map((profile) => (
                  <ChoiceCard
                    key={profile.id}
                    title={profile.name}
                    selected={config.lighting.profile === profile.id}
                    onClick={() =>
                      onChange({
                        ...config,
                        lighting: { ...config.lighting, profile: profile.id },
                      })
                    }
                  />
                ))}
              </div>
            </div>

            <div>
              <div className="text-[0.6rem] font-bold uppercase tracking-[0.14em] text-ink/40">
                Рассеиватель
              </div>
              <div className="mt-1.5 grid grid-cols-2 gap-1.5">
                {LED_DIFFUSERS.map((diffuser) => (
                  <ChoiceCard
                    key={diffuser.id}
                    title={diffuser.name}
                    description={diffuser.description}
                    selected={config.lighting.diffuser === diffuser.id}
                    onClick={() =>
                      onChange({
                        ...config,
                        lighting: { ...config.lighting, diffuser: diffuser.id },
                      })
                    }
                  />
                ))}
              </div>
            </div>

            <div>
              <div className="text-[0.6rem] font-bold uppercase tracking-[0.14em] text-ink/40">
                Управление
              </div>
              <div className="mt-1.5 grid grid-cols-3 gap-1.5">
                {LED_CONTROLS.map((control) => (
                  <ChoiceCard
                    key={control.id}
                    title={control.name}
                    description={control.description}
                    selected={config.lighting.control === control.id}
                    onClick={() =>
                      onChange({
                        ...config,
                        lighting: { ...config.lighting, control: control.id },
                      })
                    }
                  />
                ))}
              </div>
            </div>

            <div className="rounded-lg border border-ink/8 bg-white/35 px-3 py-2 text-[0.6rem] leading-relaxed text-ink/45">
              Лента {lighting.lengthM} м · {lighting.powerW} Вт · БП{" "}
              {lighting.psuW} Вт (запас 20–25 %) · ток {lighting.currentA} А
              <span className="block text-ink/38">
                Участков подключения: {lighting.runs} · точек питания:{" "}
                {lighting.feedPoints} · профиль и рассеиватель {lighting.profileM} м
                · заглушек {lighting.endCaps} · соединителей {lighting.connectors}
              </span>
            </div>
          </div>
        )}

        <div className="mt-3 rounded-lg border border-ink/8 bg-white/35 px-3 py-2 text-[0.6rem] leading-relaxed text-ink/45">
          Опоры: {supports.legs} шт. ({supports.frontLegs} спереди,{" "}
          {supports.backLegs} сзади) · {supportSystem.label}
          <span className="block text-ink/38">
            {supports.anchors > 0
              ? `Креплений пеналов к стене: ${supports.anchors} шт. · `
              : ""}
            {config.plinth && config.plinthMount === "clips"
              ? `Клипс цоколя: ${supports.clips} шт. · `
              : ""}
            {supports.note}
          </span>
        </div>

        <div className="mt-4">
          <RangeField
            label="Декоративные боковины"
            hint="Этот раздел в работе, в скором времени появится на сайте"
            value={config.sidePanels}
            min={0}
            max={2}
            step={1}
            unit="шт."
            disabled
            onChange={() => undefined}
          />
          <p className="mt-1.5 text-[0.6rem] leading-relaxed text-ink/38">
            Раздел временно недоступен. Боковины закрывают открытые торцы
            гарнитура, код и настройки блока сохранены.
          </p>
        </div>
      </PanelSection>
    </div>
  );
}

export function WardrobeOptionsPanel({
  config,
  onChange,
}: {
  config: WardrobeConfig;
  onChange: (next: WardrobeConfig) => void;
}) {
  return (
    <div className="space-y-5">
      <PanelSection title="Опции шкафа" hint="Дополнительные элементы, которые влияют на стоимость.">
        <div className="space-y-2">
          <SwitchRow
            title="Цоколь"
            description="Нижняя планка по всей ширине корпуса."
            checked={config.plinth}
            onChange={(checked) => onChange({ ...config, plinth: checked })}
          />
          <SwitchRow
            title="LED-подсветка"
            description={`Подсветка секций: ${config.sections.length} шт.`}
            checked={config.ledLighting}
            onChange={(checked) => onChange({ ...config, ledLighting: checked })}
          />
        </div>
      </PanelSection>

      <PanelSection title="Как считается шкаф">
        <ul className="space-y-2 text-[0.64rem] leading-relaxed text-ink/48">
          <li className="flex gap-2">
            <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-copper" />
            Корпус — по площади и глубине выбранного материала.
          </li>
          <li className="flex gap-2">
            <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-copper" />
            Фасады — по площади с учётом геометрии и покрытия.
          </li>
          <li className="flex gap-2">
            <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-copper" />
            Наполнение — полки, штанги, ящики и подсветка по количеству.
          </li>
        </ul>
        <p className="mt-3 rounded-lg border border-ink/8 bg-white/35 px-3 py-2 text-[0.6rem] leading-relaxed text-ink/42">
          Наполнение настраивается во вкладке «Секции». Здесь — только общие
          опции корпуса.
        </p>
      </PanelSection>
    </div>
  );
}

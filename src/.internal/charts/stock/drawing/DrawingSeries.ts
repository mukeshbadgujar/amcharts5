import type { IDisposer } from "../../../core/util/Disposer";
import type { IPoint } from "../../../core/util/IPoint";
import type { Color } from "../../../core/util/Color";
import type { ISpritePointerEvent } from "../../../core/render/Sprite";
import type { ValueAxis } from "../../xy/axes/ValueAxis";
import type { DateAxis } from "../../xy/axes/DateAxis";
import type { AxisRenderer } from "../../xy/axes/AxisRenderer";
import type { Sprite } from "../../../core/render/Sprite";
import type { DataItem } from "../../../core/render/Component";
import type { XYSeries } from "../../xy/series/XYSeries";

import { LineSeries, ILineSeriesSettings, ILineSeriesPrivate, ILineSeriesDataItem } from "../../xy/series/LineSeries";
import { Bullet } from "../../../core/render/Bullet";
import { Circle } from "../../../core/render/Circle";
import { Container } from "../../../core/render/Container";
import { Template } from "../../../core/util/Template";

import * as $array from "../../../core/util/Array";
import * as $time from "../../../core/util/Time";
import * as $type from "../../../core/util/Type";
import * as $math from "../../../core/util/Math";
import * as $object from "../../../core/util/Object";

export interface IDrawingSeriesDataItem extends ILineSeriesDataItem {
}

export interface IDrawingSeriesSettings extends ILineSeriesSettings {

	/**
	 * X-Axis.
	 */
	xAxis: DateAxis<AxisRenderer>;

	/**
	 * Y-axis.
	 */
	yAxis: ValueAxis<AxisRenderer>;

	/**
	 * Color of the lines/borders.
	 */
	strokeColor?: Color;

	/**
	 * Color of the fills.
	 */
	fillColor?: Color;

	/**
	 * Opacity of the lines/borders (0-1).
	 */
	strokeOpacity?: number;

	/**
	 * Opacity of the fills (0-1).
	 */
	fillOpacity?: number;

	/**
	 * Width of the lines/borders in pixels.
	 */
	strokeWidth?: number;

	/**
	 * Dash information for lines/borders.
	 */
	strokeDasharray?: Array<number>;

	/**
	 * [[XYSeries]] used for drawing.
	 */
	series?: XYSeries;

}

export interface IDrawingSeriesPrivate extends ILineSeriesPrivate {
}


export class DrawingSeries extends LineSeries {
	public static className: string = "DrawingSeries";
	public static classNames: Array<string> = LineSeries.classNames.concat([DrawingSeries.className]);

	declare public _settings: IDrawingSeriesSettings;
	declare public _privateSettings: IDrawingSeriesPrivate;
	declare public _dataItemSettings: IDrawingSeriesDataItem;

	protected _clickDp?: IDisposer;
	protected _moveDp?: IDisposer;
	protected _downDp?: IDisposer;
	protected _upDp?: IDisposer;

	protected _drawingEnabled: boolean = false;
	protected _isDragging: boolean = false;

	protected _clickPointerPoint?: IPoint;
	protected _movePointerPoint?: IPoint;

	protected _isDrawing: boolean = false;
	protected _isPointerDown: boolean = false;

	protected _index: number = 0;

	protected _di: Array<{ [index: string]: DataItem<IDrawingSeriesDataItem> }> = [];

	protected _dragStartPX: number = 0;
	protected _dragStartY: number = 0;

	protected _dvpX: { [index: string]: number | undefined } = {};
	protected _dvY: { [index: string]: number | undefined } = {};

	protected _isHover: boolean = false;

	protected _erasingEnabled: boolean = false;

	protected _tag?: string;

	protected _afterNew() {
		this.addTag("drawing");

		if (this._tag) {
			this.addTag(this._tag);
		}

		this.set("valueYField", "valueY");
		this.set("valueXField", "valueX");

		super._afterNew();

		this._di[0] = {};

		this.set("connect", false);
		this.set("autoGapCount", Infinity);
		this.set("ignoreMinMax", true);

		const strokesTemplate = this.strokes.template;
		strokesTemplate.set("templateField", "stroke");

		const fillsTemplate = this.fills.template;
		fillsTemplate.setAll({ templateField: "fill" });


		fillsTemplate.events.on("dragstart", (e) => {
			this._handleFillDragStart(e, this._getIndex(e.target));

			this._isPointerDown = true;
		})

		fillsTemplate.events.on("pointerdown", (e) => {
			const index = this._getIndex(e.target);
			if (this._erasingEnabled) {
				this._disposeIndex(index);
			}
			else {
				const originalEvent = e.originalEvent as any;
				if (!originalEvent.button && this._drawingEnabled) {
					this._handlePointerDown(e);
				}
			}

			const stroke = this.strokes.getIndex(this._getStrokeIndex(index));
			if (stroke) {
				stroke.dragStart(e);
			}
		})

		strokesTemplate.events.on("pointerdown", (e) => {
			if (this._erasingEnabled) {
				this._disposeIndex(this._getIndex(e.target));
			}
			else {
				const originalEvent = e.originalEvent as any;
				if (!originalEvent.button && this._drawingEnabled) {
					this._handlePointerDown(e);
				}
			}
		})

		fillsTemplate.events.on("dragstop", (e) => {
			this._isPointerDown = false;
			const index = this._getIndex(e.target);
			this._handleFillDragStop(e, index);

			const stroke = this.strokes.getIndex(this._getStrokeIndex(index));
			if (stroke) {
				stroke.dragStop(e);
			}
		})

		fillsTemplate.events.on("pointerover", (e) => {
			const index = this._getIndex(e.target);
			const stroke = this.strokes.getIndex(this._getStrokeIndex(index));
			if (stroke) {
				stroke.hover();
			}
			this._isHover = true;
			this._showSegmentBullets(index);
		})

		fillsTemplate.events.on("pointerout", () => {
			this._isHover = false;
			this._hideAllBullets();
		})

		strokesTemplate.events.on("pointerover", (e) => {
			this._isHover = true;
			this._showSegmentBullets(this._getIndex(e.target));
		})

		strokesTemplate.events.on("pointerout", () => {
			this._isHover = false;
			this._hideAllBullets();
		})

		strokesTemplate.events.on("dragstop", (e) => {
			this._handleFillDragStop(e, this._getIndex(e.target));
		})

		strokesTemplate.events.on("dragstart", (e) => {
			this._handleFillDragStart(e, this._getIndex(e.target));
		})

		this.set("groupDataDisabled", true);
		this.bulletsContainer.states.create("hidden", { visible: true, opacity: 0 });

		this.bullets.push(() => {
			const color = this.get("strokeColor", this.get("stroke"));

			const container = Container.new(this._root, {
				themeTags: ["grip"],
				setStateOnChildren: true,
				draggable: true
			})

			container.children.push(Circle.new(this._root, {
				themeTags: ["outline"],
				stroke: color
			}))

			container.children.push(Circle.new(this._root, {
				stroke: color
			}));

			container.events.on("pointerover", (event) => {
				const dataItem = event.target.dataItem;
				if (dataItem) {
					const dataContext = dataItem.dataContext as any;
					this._showSegmentBullets(dataContext.index);
				}
			})

			container.events.on("pointerout", () => {
				this._hideAllBullets();
			})

			this._addBulletInteraction(container);

			this._tweakBullet(container);

			return Bullet.new(this._root, {
				locationX: undefined,
				sprite: container
			});
		});

		this.events.on("pointerover", () => {
			this._handlePointerOver();
		})

		this.events.on("pointerout", () => {
			this._handlePointerOut();
		})
	}

	protected _disposeIndex(index: number) {
		const dataItems = this._di[index];

		if (dataItems) {
			$object.each(dataItems, (_key, dataItem) => {
				this.data.removeValue(dataItem.dataContext);
			})
		}
	}

	public clearDrawings(): void {
		$array.each(this._di, (_dataItems, index) => {
			this._disposeIndex(index);
		});
	}

	protected _getIndex(sprite: Sprite): number {
		const userData = sprite.get("userData");
		if (userData && userData.length > 0) {
			const dataItem = this.dataItems[userData[0]];
			if (dataItem) {
				const dataContext = dataItem.dataContext as any;
				if (dataContext) {
					return dataContext.index;
				}
			}
		}
		return 0;
	}

	protected _getStrokeIndex(index: number) {
		let i = 0;
		let c = index;
		this.strokes.each((stroke) => {
			const strokeIndex = this._getIndex(stroke);
			if (strokeIndex == index) {
				c = i;
			}
			i++;
		})
		return c;
	}

	protected _showSegmentBullets(index: number) {
		const dataItems = this._di[index];
		if (dataItems) {
			$object.each(dataItems, (_key, dataItem) => {
				const bullets = dataItem.bullets;
				if (bullets) {
					$array.each(bullets, (bullet) => {
						const sprite = bullet.get("sprite");
						if (sprite) {
							sprite.show();
						}
					})
				}
			})
		}
	}

	protected _hideAllBullets() {
		this.strokes.each((stroke) => {
			stroke.unhover();
		})

		if (!this._drawingEnabled && !this._isDragging) {
			const dataItems = this.dataItems;

			$array.each(dataItems, (dataItem) => {
				const bullets = dataItem.bullets;
				if (bullets) {
					$array.each(bullets, (bullet) => {
						const sprite = bullet.get("sprite");
						if (sprite) {
							sprite.hide();
						}
					})
				}
			})
		}
	}

	protected _handleFillDragStart(event: ISpritePointerEvent, index: number) {
		const chart = this.chart;
		if (chart) {
			const xAxis = this.get("xAxis");
			const yAxis = this.get("yAxis");

			const point = chart.plotContainer.toLocal(event.point);

			this._dragStartPX = xAxis.coordinateToPosition(point.x);
			this._dragStartY = this._getYValue(yAxis.positionToValue(yAxis.coordinateToPosition(point.y)));

			const dataItems = this._di[index];
			if (dataItems) {
				$object.each(dataItems, (key, dataItem) => {
					this._dvpX[key] = xAxis.valueToPosition(dataItem.get("valueX", 0));
					this._dvY[key] = dataItem.get("valueY");
				})
			}
		}
	}

	protected _handleFillDragStop(event: ISpritePointerEvent, index: number) {
		const chart = this.chart;
		if (chart) {
			const point = chart.plotContainer.toLocal(event.point);

			const xAxis = this.get("xAxis");
			const yAxis = this.get("yAxis");

			const posX = xAxis.coordinateToPosition(point.x);
			const valueY = this._getYValue(yAxis.positionToValue(yAxis.coordinateToPosition(point.y)));

			const dpx = posX - this._dragStartPX;
			const dy = valueY - this._dragStartY;

			const dataItems = this._di[index];

			if (dataItems) {
				$object.each(dataItems, (key, dataItem) => {
					const dvpx = this._dvpX[key];
					const dvy = this._dvY[key];
					if ($type.isNumber(dvpx) && $type.isNumber(dvy)) {

						const vpx = dvpx + dpx;
						const vy = dvy + dy;
						const vx = this._getXValue(xAxis.positionToValue(vpx))

						dataItem.set("valueX", vx);
						this._setXLocation(dataItem, vx);

						dataItem.set("valueY", vy);
						dataItem.set("valueYWorking", vy);
					}
				})
			}
		}

		this._updateSegment(index);
		this._updateElements();
	}

	protected _updateSegment(_index: number) {

	}

	public _updateChildren() {

		if (this.isDirty("strokeColor") || this.isDirty("fillColor") || this.isDirty("strokeOpacity") || this.isDirty("fillOpacity") || this.isDirty("strokeWidth") || this.isDirty("strokeDasharray")) {
			this.data.push({ stroke: this._getStrokeTemplate(), fill: this._getFillTemplate() });
		}

		this._updateElements();
		super._updateChildren();
	}

	protected _getFillTemplate(): Template<any> {
		const fillTemplate: any = {};

		const fillColor = this.get("fillColor");
		if (fillColor != null) {
			fillTemplate.fill = fillColor;
		}

		const fillOpacity = this.get("fillOpacity");
		if (fillOpacity != null) {
			fillTemplate.fillOpacity = fillOpacity;
		}

		return Template.new(fillTemplate);
	}

	protected _getStrokeTemplate(): Template<any> {
		const strokeTemplate: any = {};

		const strokeColor = this.get("strokeColor");
		if (strokeColor != null) {
			strokeTemplate.stroke = strokeColor;
		}

		const strokeOpacity = this.get("strokeOpacity");
		if (strokeOpacity != null) {
			strokeTemplate.strokeOpacity = strokeOpacity;
		}

		const strokeDasharray = this.get("strokeDasharray");
		if (strokeDasharray != null) {
			strokeTemplate.strokeDasharray = strokeDasharray;
		}

		const strokeWidth = this.get("strokeWidth");
		if (strokeWidth != null) {
			strokeTemplate.strokeWidth = strokeWidth;
		}

		return Template.new(strokeTemplate);
	}

	protected _updateElements() {

	}

	protected _tweakBullet(_container: Container) {

	}

	protected _addBulletInteraction(sprite: Sprite) {
		sprite.events.on("dragged", (e) => {
			this._handleBulletDragged(e);
			this._isDragging = true;
		})

		sprite.events.on("dragstart", (e) => {
			this._handleBulletDragStart(e);
		})

		sprite.events.on("dragstop", (e) => {
			this._handleBulletDragStop(e);
			this.setTimeout(() => {
				this._isDragging = false;
			}, 100)
		})

		sprite.events.on("click", (e) => {
			if (this._erasingEnabled) {
				const dataItem = e.target.dataItem;
				if (dataItem) {
					const dataContext = dataItem.dataContext as any;
					if (dataContext) {
						this._disposeIndex(dataContext.index);
					}
				}
			}
			else {
				this._handlePointerClick(e);
			}
		})
	}

	protected _handlePointerClick(event: ISpritePointerEvent) {
		const chart = this.chart;
		if (chart) {
			this._clickPointerPoint = chart.plotContainer.toLocal(event.point)
		}
	}

	// need this in order bullets not to be placed to the charts bullets container
	public _placeBulletsContainer() {
		this.children.moveValue(this.bulletsContainer);
	}

	protected _handleBulletDragged(event: ISpritePointerEvent) {

		const dataItem = event.target.dataItem as DataItem<this["_dataItemSettings"]>;

		const chart = this.chart;
		if (chart) {
			const target = event.target;
			const point = { x: target.x(), y: target.y() };
			this._handleBulletDraggedReal(dataItem, point);
		}

		const dataContext = dataItem.dataContext as any;
		if (dataContext) {
			const index = dataContext.index;
			this._updateSegment(index);
			this._updateElements();
		}
	}

	protected _handleBulletDraggedReal(dataItem: DataItem<this["_dataItemSettings"]>, point: IPoint) {
		const xAxis = this.get("xAxis");
		const yAxis = this.get("yAxis");

		const valueX = this._getXValue(xAxis.positionToValue(xAxis.coordinateToPosition(point.x)));
		const valueY = this._getYValue(yAxis.positionToValue(yAxis.coordinateToPosition(point.y)));

		dataItem.set("valueX", valueX);
		this._setXLocation(dataItem, valueX);

		dataItem.set("valueY", valueY);
		dataItem.set("valueYWorking", valueY);

		this._positionBullets(dataItem);
	}

	protected _handleBulletDragStart(_event: ISpritePointerEvent) {

	}

	protected _handleBulletDragStop(_event: ISpritePointerEvent) {

	}

	protected _handlePointerOver() {

	}

	protected _handlePointerOut() {

	}

	protected _addContextInfo(index: number, corner?: any) {
		const dataItems = this.dataItems;
		const len = dataItems.length;
		const dataItem = dataItems[len - 1];
		const dataContext = dataItem.dataContext as any;
		if (dataContext) {
			dataContext.index = index;
			if (corner != null) {
				dataContext.corner = corner;
			}
		}
		if (!this._di[index]) {
			this._di[index] = {};
		}
		this._di[index][corner] = dataItem;
	}

	public enableDrawing() {
		const chart = this.chart;
		this._erasingEnabled = false;
		this._drawingEnabled = true;
		if (chart) {
			if (!this._clickDp) {
				this._clickDp = chart.plotContainer.events.on("click", (e) => {
					const originalEvent = e.originalEvent as any;
					if (!originalEvent.button && !this._erasingEnabled) {
						this._handlePointerClick(e);
					}
				})
			}

			if (!this._downDp) {
				this._downDp = chart.plotContainer.events.on("pointerdown", (e) => {
					const originalEvent = e.originalEvent as any;
					if (!originalEvent.button && !this._erasingEnabled) {
						this._handlePointerDown(e);
					}
				})
			}

			if (!this._upDp) {
				this._upDp = chart.plotContainer.events.on("globalpointerup", (e) => {
					const originalEvent = e.originalEvent as any;
					if (!originalEvent.button && !this._erasingEnabled) {
						this._handlePointerUp(e);
					}
				})
			}

			if (!this._moveDp) {
				this._moveDp = chart.plotContainer.events.on("globalpointermove", (e) => {
					if (!this._erasingEnabled) {
						this._handlePointerMove(e);
					}
				})
			}
		}
	}

	public enableErasing() {
		this._erasingEnabled = true;
	}

	public disableErasing() {
		this._erasingEnabled = false;
	}

	public disableDrawing() {
		this._erasingEnabled = false;
		this._drawingEnabled = false;
		this._isDrawing = false;
		if (this._clickDp) {
			this._clickDp.dispose();
			this._clickDp = undefined;
		}

		if (this._downDp) {
			this._downDp.dispose();
			this._downDp = undefined;
		}

		if (this._upDp) {
			this._upDp.dispose();
			this._upDp = undefined;
		}
		this._hideAllBullets();
	}

	protected _handlePointerMove(event: ISpritePointerEvent) {
		const chart = this.chart;
		if (chart) {
			this._movePointerPoint = chart.plotContainer.toLocal(event.point)
		}
	}

	protected _handlePointerDown(_event: ISpritePointerEvent) {
		this._isPointerDown = true;
	}

	protected _handlePointerUp(_event: ISpritePointerEvent) {
		this._isPointerDown = false;
	}

	public startIndex(): number {
		return 0;
	}

	public endIndex(): number {
		return this.dataItems.length;
	}

	protected _setXLocation(dataItem: DataItem<this["_dataItemSettings"]>, value: number) {
		this._setXLocationReal(dataItem, value);
	}

	protected _setXLocationReal(dataItem: DataItem<this["_dataItemSettings"]>, value: number) {
		const xAxis = this.get("xAxis");
		const baseInterval = xAxis.getPrivate("baseInterval");
		const open = $time.round(new Date(value), baseInterval.timeUnit, baseInterval.count, this._root.locale.firstDayOfWeek, this._root.utc).getTime();
		const close = $time.add(new Date(open), baseInterval.timeUnit, baseInterval.count, this._root.utc).getTime();
		const locationX = (value - open) / (close - open);
		dataItem.set("locationX", locationX);
	}

	public disposeDataItem(dataItem: DataItem<this["_dataItemSettings"]>) {
		super.disposeDataItem(dataItem);
		const dataContext = dataItem.dataContext as any;
		if (dataContext) {
			const index = dataContext.index;

			this.markDirtyValues();

			const dataItems = this._di[index];

			if (dataItems) {
				$object.each(dataItems, (_key, dataItem) => {
					super.disposeDataItem(dataItem);
				})
			}
		}
	}


	protected _getYValue(value: number): number {
		if (this.get("valueYShow") == "valueYChangeSelectionPercent") {
			const baseValueSeries = this.getPrivate("baseValueSeries");
			if (baseValueSeries) {
				const baseValue = baseValueSeries._getBase("valueY");
				value = value / 100 * baseValue + baseValue;
			}
		}
		return value;
	}

	protected _getXValue(value: number): number {
		const xAxis = this.get("xAxis");
		const min = xAxis.getPrivate("min", 0) + 1;
		const max = xAxis.getPrivate("max", 1) - 1;
		return $math.fitToRange(value, min, max);
	}
}
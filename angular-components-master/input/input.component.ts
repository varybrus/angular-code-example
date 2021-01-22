import {
  Component,
  ChangeDetectionStrategy,
  Input,
  ViewEncapsulation,
  OnChanges,
  SimpleChanges,
  Output,
  EventEmitter,
  OnDestroy,
  ViewChild,
  ElementRef,
  ChangeDetectorRef,
  forwardRef,
  DoCheck,
  ContentChild
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR, FormControlName } from '@angular/forms';
import { Subject } from 'rxjs';
import { takeUntil, debounceTime, map, tap, filter } from 'rxjs/operators';

import { NumericInputOptions } from '../../models/input/numeric-input-options.model';
import { FormControlErrorFormatter } from '../../helpers/form-control-validation-error-helper';

const DEFAULT_NUMERIC_OPTIONS = {
  integer: true,
};

@Component({
  selector: 'lm-ui-input',
  templateUrl: './input.component.html',
  styleUrls: ['./input.component.scss'],
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      multi: true,
      useExisting: forwardRef(() => InputComponent),
    },
  ]
})
export class InputComponent implements ControlValueAccessor, OnChanges, DoCheck, OnDestroy {

  @ContentChild(FormControlName) private readonly controlName: FormControlName;
  @ViewChild('input') private readonly inputElement: ElementRef<HTMLInputElement>;

  @Input() dataAutotest: string;
  @Input() iconType: 'search';
  @Input() maxLength: number;
  @Input() numeric: NumericInputOptions;
  @Input() placeholder: string = '';
  @Input() value: string = '';

  @Output() valueChange: EventEmitter<string> = new EventEmitter();

  error: string = '';
  focused: boolean = false;
  invalid: boolean = false;

  private readonly destroy$: Subject<void> = new Subject();
  private readonly invalidatePropertiesStream$: Subject<void> = new Subject();
  private readonly valueStream$: Subject<string> = new Subject();

  private currentValue: string = '';
  private inputBlurOccured: boolean;
  private inputFocusOccured: boolean;
  private mouseDownOccured: boolean;
  private propagateChange: any;

  constructor(private readonly cdr: ChangeDetectorRef) {
    this.initializeSubscriptions();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes.numeric) {
      this.numeric = changes.numeric.currentValue
        ? {
          ...DEFAULT_NUMERIC_OPTIONS,
          ...changes.numeric.currentValue
        }
        : null;
    }
    if (changes.value) {
      this.valueStream$.next(changes.value.currentValue);
    }
    this.invalidateProperties();
  }

  ngDoCheck(): void {
    this.error = '';
    if (this.controlName && this.controlName.control) {
      const control = this.controlName.control;
      if (control.errors) {
        const errors: any[] = Object.keys(control.errors)
          .map(key => FormControlErrorFormatter.getErrorMessage(key, control.getError(key)));
        this.error = errors.join('\b');
      }
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
  }

  checkIcon(type: string): boolean {
    return this.iconType === type;
  }

  // #region ControlValueAccessor impl 

  writeValue(value: any): void {
    this.valueStream$.next(value);
  }

  registerOnChange(fn: any): void {
    this.propagateChange = fn;
  }

  registerOnTouched(fn: any): void {
  }

  // #endregion

  // #region DOM event subscriptions

  onHostElementDoubleClick(event: Event): void {
    this.inputElement.nativeElement.select();
  }

  onHostElementMouseDown(event: Event): void {
    this.mouseDownOccured = true;
    this.invalidateProperties();
  }

  onInputElementBlur(event: Event): void {
    this.inputBlurOccured = true;
    this.invalidateProperties();
  }

  onInputElementFocus(event: Event): void {
    this.inputFocusOccured = true;
    this.invalidateProperties();
  }

  onInputElementInput(event: Event): void {
    const value = this.getInputValueFromEvent(event);
    this.valueStream$.next(value);
  }

  onInputElementMouseDown(event: Event): void {
    event.stopImmediatePropagation();
  }

  // #endregion

  private applyNumericCompliance(value: string, numericOptions: NumericInputOptions): string {
    let processed: string = value;
    if (numericOptions.integer) {
      // Remove character that is not allowed (digits only).
      processed = processed.replace(/[^\d]/g, '');
    }
    if (processed.length || numericOptions.preventEmpty) {
      // Process string as a number.
      // In case of 'preventEmpty' flag is true, the user gets naught if string is empty.
      processed = Number(processed).toString();
    }

    return processed;
  }

  private commitProperties(): void {
    if (this.mouseDownOccured || this.inputFocusOccured || this.inputBlurOccured) {

      const focusReceived = this.mouseDownOccured || this.inputFocusOccured;
      const focusStateChanged = this.focused !== focusReceived || this.inputBlurOccured;

      if (focusStateChanged) {
        this.focused = focusReceived;

        const decorate = !this.focused && !this.invalid;
        this.setInputValue(this.currentValue, decorate);

        if (this.focused) {
          this.inputElement.nativeElement.focus();
        }

        this.cdr.detectChanges();
      }

      this.mouseDownOccured = false;
      this.inputBlurOccured = false;
      this.inputFocusOccured = false;
    }
  }

  private getDecoratedValue(value: string, config: { numeric?: NumericInputOptions }): string {
    if (config.numeric && config.numeric.percents && value.length) {
      return this.toPercentString(value);
    }

    return value;
  }

  private getInputValueFromEvent(event: Event): string {
    return (event.currentTarget as HTMLInputElement).value;
  }

  private initializeSubscriptions(): void {
    // Subscribe on invalidateProperties stream.
    this.invalidatePropertiesStream$
      .pipe(
        debounceTime(0),
        takeUntil(this.destroy$),
      )
      .subscribe(() => this.commitProperties());
    // Subscribe on stream of values.
    this.valueStream$
      .pipe(
        // Convert null or undefined to the empty string.
        map(value => (value !== null && value !== undefined) ? value.toString() : ''),
        map(value => this.processInputValue(value)),
        // Set processed value back to the input
        // and decorate it if not in focus.
        tap(value => this.setInputValue(value, !this.focused)),
        // TODO: In case of any unobvious issue check the next line.
        filter(value => this.currentValue !== value),
        tap(value => this.currentValue = value),
        // Set new value back to the FormControl.
        tap(value => this.propagateChange && this.propagateChange(value)),
        takeUntil(this.destroy$),
      )
      .subscribe(value => this.valueChange.emit(value));
  }

  protected invalidateProperties(): void {
    this.invalidatePropertiesStream$.next();
  }

  private processInputValue(value: string): string {
    let processed: string = value;
    // Apply maxLength restriction.
    if (this.maxLength && processed.length > this.maxLength) {
      processed = processed.substr(0, this.maxLength);
    }
    // Apply restrictions if required.
    // If `numeric` property has configuration, 
    // apply appropriate compliances to the input value.
    if (this.numeric) {
      processed = this.applyNumericCompliance(processed, this.numeric);
    }

    return processed;
  }

  private setInputValue(value: string, decorate: boolean = false): void {
    if (decorate) {
      this.inputElement.nativeElement.value = this.getDecoratedValue(value, { numeric: this.numeric });
    } else {
      this.inputElement.nativeElement.value = value;
    }
  }

  private toPercentString(value: string): string {
    return value.length
      ? `${value}%`
      : ``;
  }

}

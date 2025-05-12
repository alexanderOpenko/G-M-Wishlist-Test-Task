if (!customElements.get('product-info')) {
  customElements.define(
    'product-info',
    class ProductInfo extends HTMLElement {
      quantityInput = undefined;
      quantityForm = undefined;
      onVariantChangeUnsubscriber = undefined;
      cartUpdateUnsubscriber = undefined;
      abortController = undefined;
      pendingRequestUrl = null;
      preProcessHtmlCallbacks = [];
      postProcessHtmlCallbacks = [];
      shouldUpdateURL = true;
      productIdFromList = null;

      constructor() {
        super();

        this.shouldUpdateURL = this.dataset.updateUrl !== 'false';

        this.quantityInput = this.querySelector('.quantity__input');

        const storedData = JSON.parse(localStorage.getItem("savedProductVariants"));
        let idSet = null;

        if (storedData.length) {
          idSet = new Set(storedData.map(item => item.id));
        }

        const variantsInputs = document.querySelectorAll('product-form input[name="id"]');

        variantsInputs.forEach(input => {
          const id = input.value;

          let parentSelector = null;

          if (this.dataset.productsList) {
            parentSelector = '.product-item';
          } else {
            parentSelector = 'product-info';
          }
          const productWrapper = input.closest(parentSelector);

          // update button save state
          if (productWrapper) {
            if (storedData.length && id && idSet.has(String(id))) {
              const button = productWrapper.querySelector('.js-product-variant-save');

              if (button) {
                toggleSaveButton(button, true, "Saved")
              }
            }

            if (this.dataset.productsList) {
              const selectedVariantData = productWrapper.querySelector('script[data-selected-variant]');

              if (selectedVariantData) {
                const selectedVariant = JSON.parse(selectedVariantData.innerHTML);
                //update price on init
                const formattedPrice = (selectedVariant.price / 100).toFixed(2).replace('.', ',');

                productWrapper.querySelector('.products-list-price').innerHTML = formattedPrice

                // update product image
                const product_image = productWrapper.querySelector('img')
                product_image.src = selectedVariant.featured_image.src

                // update product href
                const product_href = productWrapper.querySelector('a')
                const url = new URL(product_href.href);
                url.searchParams.set('variant', selectedVariant.id);
                product_href.href = url.toString();

                setTimeout(() => {
                  const selects = document.querySelectorAll('select');
                  selects.forEach(select => {
                    select.selectedIndex = 0;
                  });
                }, 100)
              }
            }
          }
        })
      }

      connectedCallback() {
        this.initializeProductSwapUtility();

        this.onVariantChangeUnsubscriber = subscribe(
          PUB_SUB_EVENTS.optionValueSelectionChange,
          this.handleOptionValueChange.bind(this)
        );

        this.initQuantityHandlers();
        this.dispatchEvent(new CustomEvent('product-info:loaded', { bubbles: true }));
      }

      addPreProcessCallback(callback) {
        this.preProcessHtmlCallbacks.push(callback);
      }

      initQuantityHandlers() {
        if (!this.quantityInput) return;

        this.quantityForm = this.querySelector('.product-form__quantity');
        if (!this.quantityForm) return;

        this.setQuantityBoundries();
        if (!this.dataset.originalSection) {
          this.cartUpdateUnsubscriber = subscribe(PUB_SUB_EVENTS.cartUpdate, this.fetchQuantityRules.bind(this));
        }
      }

      disconnectedCallback() {
        this.onVariantChangeUnsubscriber();
        this.cartUpdateUnsubscriber?.();
      }

      initializeProductSwapUtility() {
        this.preProcessHtmlCallbacks.push((html) =>
          html.querySelectorAll('.scroll-trigger').forEach((element) => element.classList.add('scroll-trigger--cancel'))
        );
        this.postProcessHtmlCallbacks.push((newNode) => {
          window?.Shopify?.PaymentButton?.init();
          window?.ProductModel?.loadShopifyXR();
        });
      }

      handleOptionValueChange({ data: { event, target, selectedOptionValues } }) {
        if (!this.contains(event.target)) return;

        //check if products list page
        this.productIdFromList = target.closest('variant-selects')?.dataset.productId;

        this.resetProductFormState();
        let productUrl = '';

        this.pendingRequestUrl = productUrl;

        let shouldSwapProduct = false

        if (this.productIdFromList) {
          shouldSwapProduct = false
          productUrl = target.closest('.product-wrapper').dataset.url;
        } else {
          shouldSwapProduct = this.dataset.url !== productUrl;
          productUrl = target.dataset.productUrl || this.pendingRequestUrl || this.dataset.url;
        }

        const shouldFetchFullPage = this.dataset.updateUrl === 'true' && shouldSwapProduct;

        this.renderProductInfo({
          requestUrl: this.buildRequestUrlWithParams(productUrl, selectedOptionValues, shouldFetchFullPage),
          targetId: target.id,
          callback: shouldSwapProduct
            ? this.handleSwapProduct(productUrl, shouldFetchFullPage)
            : this.handleUpdateProductInfo(productUrl),
        });
      }

      resetProductFormState() {
        const productForm = this.productForm;

        productForm?.toggleSubmitButton(true);
        productForm?.handleErrorMessage();
      }

      handleSwapProduct(productUrl, updateFullPage) {
        return (html) => {
          this.productModal?.remove();

          const selector = updateFullPage ? "product-info[id^='MainProduct']" : 'product-info';
          const variant = this.getSelectedVariant(html.querySelector(selector));
          this.updateURL(productUrl, variant?.id);

          setTimeout(() => {
            this.saveButtonHandler(variant)
          }, 100)

          if (updateFullPage) {
            document.querySelector('head title').innerHTML = html.querySelector('head title').innerHTML;

            HTMLUpdateUtility.viewTransition(
              document.querySelector('main'),
              html.querySelector('main'),
              this.preProcessHtmlCallbacks,
              this.postProcessHtmlCallbacks
            );
          } else {
            HTMLUpdateUtility.viewTransition(
              this,
              html.querySelector('product-info'),
              this.preProcessHtmlCallbacks,
              this.postProcessHtmlCallbacks
            );
          }
        };
      }

      renderProductInfo({ requestUrl, targetId, callback }) {
        this.abortController?.abort();
        this.abortController = new AbortController();

        fetch(requestUrl, { signal: this.abortController.signal })
          .then((response) => response.text())
          .then((responseText) => {
            this.pendingRequestUrl = null;
            const html = new DOMParser().parseFromString(responseText, 'text/html');
            callback(html);
          })
          .then(() => {
            // set focus to last clicked option value
            document.querySelector(`#${targetId}`)?.focus();
          })
          .catch((error) => {
            if (error.name === 'AbortError') {
              console.log('Fetch aborted by user');
            } else {
              console.error(error);
            }
          });
      }

      getSelectedVariant(productInfoNode) {
        let selectedVariant = {}
        if (this.productIdFromList) {
          selectedVariant = productInfoNode.querySelector(`.product-wrapper[data-product-id="${this.productIdFromList}"] [data-selected-variant]`)?.innerHTML;
        } else {
          selectedVariant = productInfoNode.querySelector('variant-selects [data-selected-variant]')?.innerHTML;
        }

        return !!selectedVariant ? JSON.parse(selectedVariant) : null;
      }

      buildRequestUrlWithParams(url, optionValues, shouldFetchFullPage = false) {
        const params = [];

        !shouldFetchFullPage && params.push(`section_id=${this.sectionId}`);

        if (optionValues.length) {
          params.push(`option_values=${optionValues.join(',')}`);
        }

        return `${url}?${params.join('&')}`;
      }

      updateOptionValues(html) {
        let variantSelects = null;

        if (this.productIdFromList) {
          variantSelects = html.querySelector(`.product-wrapper[data-product-id="${this.productIdFromList}"] variant-selects`);
        } else {
          variantSelects = html.querySelector('variant-selects');
        }

        if (variantSelects) {
          HTMLUpdateUtility.viewTransition(this.variantSelectors, variantSelects, this.preProcessHtmlCallbacks);
        }
      }

      isVariantSaved(variantId) {
        const savedVariants = JSON.parse(localStorage.getItem('savedProductVariants')) || [];

        return savedVariants.some(variant => variant.id == variantId);
      }

      saveButtonHandler(variant) {
        const isVariantSaved = this.isVariantSaved(variant.id)

        let saveButton = null;

        if (this.productIdFromList) {
          saveButton = this.querySelector(`.product-wrapper[data-product-id="${this.productIdFromList}"] .js-product-variant-save`)
        } else {
          saveButton = document.querySelector(`#ProductVariantSaveButton-${this.sectionId}`);
        }

        if (isVariantSaved) {
          toggleSaveButton(saveButton, true, 'Saved')
        } else {
          toggleSaveButton(saveButton, false)
        }
      }

      handleUpdateProductInfo(productUrl) {
        return (html) => {
          const variant = this.getSelectedVariant(html);
          this.pickupAvailability?.update(variant);
          this.updateOptionValues(html);
          this.updateURL(productUrl, variant?.id);
          this.updateVariantInputs(variant?.id);

          if (!variant) {
            this.setUnavailable();
            return;
          }

          this.saveButtonHandler(variant)

          if (!this.productIdFromList) {
            this.updateMedia(html, variant?.featured_media?.id);
          } else {
            const product_href = this.querySelector(`.product-wrapper[data-product-id="${this.productIdFromList}"] a`)
            const product_image = this.querySelector(`.product-wrapper[data-product-id="${this.productIdFromList}"] img`)
            const selectedVariantData = html.querySelector(`.product-wrapper[data-product-id="${this.productIdFromList}"] [data-selected-variant]`).innerHTML;
            const selectedVariant = JSON.parse(selectedVariantData);

            product_image.src = selectedVariant.featured_image.src

            const url = new URL(product_href.href);
            url.searchParams.set('variant', selectedVariant.id);
            product_href.href = url.toString();
          }

          const updateSourceFromDestination = (id, shouldHide = (source) => false) => {
            let source = '';
            let destination = '';

            if (this.productIdFromList) {
              const selectedVariantData = html.querySelector(`.product-wrapper[data-product-id="${this.productIdFromList}"] [data-selected-variant]`).innerHTML;
              const selectedVariant = JSON.parse(selectedVariantData);
              const formattedPrice = (selectedVariant.price / 100).toFixed(2).replace('.', ',');

              this.querySelector(`#${id}-${this.productIdFromList}`).innerHTML = formattedPrice;
            }

            if (!this.productIdFromList) {
              source = html.getElementById(`${id}-${this.sectionId}`);
              destination = this.querySelector(`#${id}-${this.dataset.section}`);
            }

            if (source && destination && !this.productIdFromList) {
              destination.innerHTML = source.innerHTML;
              destination.classList.toggle('hidden', shouldHide(source));
            }
          };

          if (this.productIdFromList) {
            updateSourceFromDestination('price');
          } else {
            updateSourceFromDestination('price');
            updateSourceFromDestination('Sku', ({ classList }) => classList.contains('hidden'));
            updateSourceFromDestination('Inventory', ({ innerText }) => innerText === '');
            updateSourceFromDestination('Volume');
            updateSourceFromDestination('Price-Per-Item', ({ classList }) => classList.contains('hidden'));
          }

          this.updateQuantityRules(this.sectionId, html);
          this.querySelector(`#Quantity-Rules-${this.dataset.section}`)?.classList.remove('hidden');
          this.querySelector(`#Volume-Note-${this.dataset.section}`)?.classList.remove('hidden');

          let BtnSelector = html.getElementById(`ProductSubmitButton-${this.sectionId}`);

          if (this.productIdFromList) {
            BtnSelector = html.querySelector(`[data-button-id="${this.productIdFromList}"]`)
          }

          this.productForm?.toggleSubmitButton(
            BtnSelector?.hasAttribute('disabled') ?? true,
            window.variantStrings.soldOut
          );

          publish(PUB_SUB_EVENTS.variantChange, {
            data: {
              sectionId: this.sectionId,
              html,
              variant,
            },
          });
        };
      }

      updateVariantInputs(variantId) {
        let classesToScope = `#product-form-${this.dataset.section}, #product-form-installment-${this.dataset.section}`

        if (this.productIdFromList) {
          classesToScope = `product-form[data-product-id="${this.productIdFromList}"]`
        }

        this.querySelectorAll(classesToScope).forEach((productForm) => {
          const input = productForm.querySelector('input[name="id"]');
          input.value = variantId ?? '';
          input.dispatchEvent(new Event('change', { bubbles: true }));
        });
      }

      updateURL(url, variantId) {
        if (!this.shouldUpdateURL) {
          return
        }

        this.querySelector('share-button')?.updateUrl(
          `${window.shopUrl}${url}${variantId ? `?variant=${variantId}` : ''}`
        );

        if (this.dataset.updateUrl === 'false') return;
        window.history.replaceState({}, '', `${url}${variantId ? `?variant=${variantId}` : ''}`);
      }

      setUnavailable() {
        this.productForm?.toggleSubmitButton(true, window.variantStrings.unavailable);

        const selectors = ['price', 'Inventory', 'Sku', 'Price-Per-Item', 'Volume-Note', 'Volume', 'Quantity-Rules']
          .map((id) => `#${id}-${this.dataset.section}`)
          .join(', ');
        document.querySelectorAll(selectors).forEach(({ classList }) => classList.add('hidden'));
      }

      updateMedia(html, variantFeaturedMediaId) {
        if (!variantFeaturedMediaId) return;

        const mediaGallerySource = this.querySelector('media-gallery ul');
        const mediaGalleryDestination = html.querySelector(`media-gallery ul`);

        const refreshSourceData = () => {
          if (this.hasAttribute('data-zoom-on-hover')) enableZoomOnHover(2);
          const mediaGallerySourceItems = Array.from(mediaGallerySource.querySelectorAll('li[data-media-id]'));
          const sourceSet = new Set(mediaGallerySourceItems.map((item) => item.dataset.mediaId));
          const sourceMap = new Map(
            mediaGallerySourceItems.map((item, index) => [item.dataset.mediaId, { item, index }])
          );
          return [mediaGallerySourceItems, sourceSet, sourceMap];
        };

        if (mediaGallerySource && mediaGalleryDestination) {
          let [mediaGallerySourceItems, sourceSet, sourceMap] = refreshSourceData();
          const mediaGalleryDestinationItems = Array.from(
            mediaGalleryDestination.querySelectorAll('li[data-media-id]')
          );
          const destinationSet = new Set(mediaGalleryDestinationItems.map(({ dataset }) => dataset.mediaId));
          let shouldRefresh = false;

          // add items from new data not present in DOM
          for (let i = mediaGalleryDestinationItems.length - 1; i >= 0; i--) {
            if (!sourceSet.has(mediaGalleryDestinationItems[i].dataset.mediaId)) {
              mediaGallerySource.prepend(mediaGalleryDestinationItems[i]);
              shouldRefresh = true;
            }
          }

          // remove items from DOM not present in new data
          for (let i = 0; i < mediaGallerySourceItems.length; i++) {
            if (!destinationSet.has(mediaGallerySourceItems[i].dataset.mediaId)) {
              mediaGallerySourceItems[i].remove();
              shouldRefresh = true;
            }
          }

          // refresh
          if (shouldRefresh) [mediaGallerySourceItems, sourceSet, sourceMap] = refreshSourceData();

          // if media galleries don't match, sort to match new data order
          mediaGalleryDestinationItems.forEach((destinationItem, destinationIndex) => {
            const sourceData = sourceMap.get(destinationItem.dataset.mediaId);

            if (sourceData && sourceData.index !== destinationIndex) {
              mediaGallerySource.insertBefore(
                sourceData.item,
                mediaGallerySource.querySelector(`li:nth-of-type(${destinationIndex + 1})`)
              );

              // refresh source now that it has been modified
              [mediaGallerySourceItems, sourceSet, sourceMap] = refreshSourceData();
            }
          });
        }

        // set featured media as active in the media gallery
        this.querySelector(`media-gallery`)?.setActiveMedia?.(
          `${this.dataset.section}-${variantFeaturedMediaId}`,
          true
        );

        // update media modal
        const modalContent = this.productModal?.querySelector(`.product-media-modal__content`);
        const newModalContent = html.querySelector(`product-modal .product-media-modal__content`);
        if (modalContent && newModalContent) modalContent.innerHTML = newModalContent.innerHTML;
      }

      setQuantityBoundries() {
        const data = {
          cartQuantity: this.quantityInput.dataset.cartQuantity ? parseInt(this.quantityInput.dataset.cartQuantity) : 0,
          min: this.quantityInput.dataset.min ? parseInt(this.quantityInput.dataset.min) : 1,
          max: this.quantityInput.dataset.max ? parseInt(this.quantityInput.dataset.max) : null,
          step: this.quantityInput.step ? parseInt(this.quantityInput.step) : 1,
        };

        let min = data.min;
        const max = data.max === null ? data.max : data.max - data.cartQuantity;
        if (max !== null) min = Math.min(min, max);
        if (data.cartQuantity >= data.min) min = Math.min(min, data.step);

        this.quantityInput.min = min;

        if (max) {
          this.quantityInput.max = max;
        } else {
          this.quantityInput.removeAttribute('max');
        }
        this.quantityInput.value = min;

        publish(PUB_SUB_EVENTS.quantityUpdate, undefined);
      }

      fetchQuantityRules() {
        const currentVariantId = this.productForm?.variantIdInput?.value;
        if (!currentVariantId) return;

        this.querySelector('.quantity__rules-cart .loading__spinner').classList.remove('hidden');
        return fetch(`${this.dataset.url}?variant=${currentVariantId}&section_id=${this.dataset.section}`)
          .then((response) => response.text())
          .then((responseText) => {
            const html = new DOMParser().parseFromString(responseText, 'text/html');
            this.updateQuantityRules(this.dataset.section, html);
          })
          .catch((e) => console.error(e))
          .finally(() => this.querySelector('.quantity__rules-cart .loading__spinner').classList.add('hidden'));
      }

      updateQuantityRules(sectionId, html) {
        if (!this.quantityInput) return;
        this.setQuantityBoundries();

        const quantityFormUpdated = html.getElementById(`Quantity-Form-${sectionId}`);
        const selectors = ['.quantity__input', '.quantity__rules', '.quantity__label'];
        for (let selector of selectors) {
          const current = this.quantityForm.querySelector(selector);
          const updated = quantityFormUpdated.querySelector(selector);
          if (!current || !updated) continue;
          if (selector === '.quantity__input') {
            const attributes = ['data-cart-quantity', 'data-min', 'data-max', 'step'];
            for (let attribute of attributes) {
              const valueUpdated = updated.getAttribute(attribute);
              if (valueUpdated !== null) {
                current.setAttribute(attribute, valueUpdated);
              } else {
                current.removeAttribute(attribute);
              }
            }
          } else {
            current.innerHTML = updated.innerHTML;
          }
        }
      }

      get productForm() {
        if (this.productIdFromList) {
          return this.querySelector(`product-form[data-product-id="${this.productIdFromList}"]`);
        }

        return this.querySelector(`product-form`);
      }

      get productModal() {
        return document.querySelector(`#ProductModal-${this.dataset.section}`);
      }

      get pickupAvailability() {
        return this.querySelector(`pickup-availability`);
      }

      get variantSelectors() {
        if (this.productIdFromList) {
          return this.querySelector(`.product-wrapper[data-product-id="${this.productIdFromList}"] variant-selects`);
        }

        return this.querySelector('variant-selects');
      }

      get relatedProducts() {
        const relatedProductsSectionId = SectionId.getIdForSection(
          SectionId.parseId(this.sectionId),
          'related-products'
        );
        return document.querySelector(`product-recommendations[data-section-id^="${relatedProductsSectionId}"]`);
      }

      get quickOrderList() {
        const quickOrderListSectionId = SectionId.getIdForSection(
          SectionId.parseId(this.sectionId),
          'quick_order_list'
        );
        return document.querySelector(`quick-order-list[data-id^="${quickOrderListSectionId}"]`);
      }

      get sectionId() {
        return this.dataset.originalSection || this.dataset.section;
      }
    }
  );
}

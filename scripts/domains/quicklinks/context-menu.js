
import { store } from './store.js';
import { t } from '../../platform/i18n.js';
import { modalLayer } from '../../platform/modal-layer.js';

const MODAL_ID = 'context-menu';

class ContextMenu {
    constructor() {
        this.element = null;
        this.currentItem = null;
        this.callbacks = null;
        this.source = 'launchpad';

        this._initialized = false;
        this._destroyed = false;

        this._boundHandleItemClick = this._handleItemClick.bind(this);
        this._boundHandleWheel = this._handleWheel.bind(this);
        this._boundHandleKeydown = this._handleKeydown.bind(this);
    }

    init() {
        if (this._initialized || this._destroyed) return;

        this._bindElement();
        if (!this.element) {
            this._createElement();
        }

        this._ensureContentContainer();
        this._bindEvents();

        this._initialized = true;
    }

    _bindElement() {
        this.element = document.getElementById('quicklinkContextMenu');
    }

    _createElement() {
        this.element = document.createElement('div');
        this.element.id = 'quicklinkContextMenu';
        this.element.className = 'context-menu';
        this.element.dataset.modal = 'true';
        this.element.innerHTML = `<div class="context-menu-content"></div>`;
        document.body.appendChild(this.element);
    }

    _ensureContentContainer() {
        if (!this.element) return;

        let content = this.element.querySelector('.context-menu-content');
        if (content) return;

        content = document.createElement('div');
        content.className = 'context-menu-content';
        this.element.innerHTML = '';
        this.element.appendChild(content);
    }

    _bindEvents() {

        document.addEventListener('wheel', this._boundHandleWheel, { passive: true });

        document.addEventListener('keydown', this._boundHandleKeydown);

        if (this.element) {
            this.element.addEventListener('click', this._boundHandleItemClick);
        }
    }

    show(event, item, callbacks = {}, source = 'launchpad') {
        if (!this.element || this._destroyed) return;

        this.close();

        if (typeof callbacks === 'string') {
            source = callbacks;
            callbacks = {};
        }

        this.currentItem = item;
        this.callbacks = callbacks;
        this.source = source === 'dock' ? 'dock' : 'launchpad';

        this._ensureContentContainer();

        if (!this.element.classList.contains('context-menu') &&
            !this.element.classList.contains('quicklink-context-menu')) {
            this.element.classList.add('context-menu');
        }

        this._renderContent();

        const SAFETY_MARGIN = 12;

        this.element.style.visibility = 'hidden';
        this.element.style.opacity = '0';
        this.element.classList.add('active');

        const menuRect = this.element.getBoundingClientRect();
        const menuWidth = menuRect.width;
        const menuHeight = menuRect.height;

        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;

        const clickX = event.clientX;
        const clickY = event.clientY;

        const spaceBelow = viewportHeight - clickY - SAFETY_MARGIN;
        const spaceAbove = clickY - SAFETY_MARGIN;
        const spaceRight = viewportWidth - clickX - SAFETY_MARGIN;
        const spaceLeft = clickX - SAFETY_MARGIN;

        let finalX;
        let originX = 'left';
        if (spaceRight >= menuWidth) {
            finalX = clickX;
        } else if (spaceLeft >= menuWidth) {
            finalX = clickX - menuWidth;
            originX = 'right';
        } else {
            finalX = Math.max(
                SAFETY_MARGIN,
                Math.min(clickX - menuWidth / 2, viewportWidth - menuWidth - SAFETY_MARGIN)
            );
            originX = 'center';
        }

        let finalY;
        let originY = 'top';
        if (spaceBelow >= menuHeight) {
            finalY = clickY;
        } else if (spaceAbove >= menuHeight) {
            finalY = clickY - menuHeight;
            originY = 'bottom';
        } else {
            if (spaceBelow >= spaceAbove) {
                finalY = viewportHeight - menuHeight - SAFETY_MARGIN;
                originY = 'bottom';
            } else {
                finalY = SAFETY_MARGIN;
                originY = 'top';
            }
        }

        this.element.style.left = `${finalX}px`;
        this.element.style.top = `${finalY}px`;
        this.element.style.transformOrigin = `${originX} ${originY}`;

        this.element.style.visibility = '';
        this.element.style.opacity = '';

        this.element.setAttribute('aria-hidden', 'false');

        modalLayer.register(
            MODAL_ID,
            modalLayer.constructor.LEVEL.CONTEXT_MENU,
            this.element,
            () => this.close()
        );

        requestAnimationFrame(() => {
            const firstItem = this.element?.querySelector('.context-menu-item:not(.disabled)');
            if (firstItem) {
                firstItem.focus({ preventScroll: true });
            }
        });

        event.stopPropagation();
    }

    close() {
        if (!this.element) return;

        const wasActive = this.element.classList.contains('active');
        if (!wasActive) return;  // Idempotency protection: don't re-execute if already closed

        this.element.classList.remove('active');
        this.element.setAttribute('aria-hidden', 'true');

        this.element.style.transformOrigin = '';

        this.currentItem = null;
        this.callbacks = null;
        this.source = 'launchpad';

        modalLayer.unregister(MODAL_ID);
    }

    get isOpen() {
        return this.element?.classList.contains('active') ?? false;
    }

    _handleItemClick(e) {
        const menuItem = e.target.closest('.context-menu-item, .quicklink-context-menu-item');
        if (!menuItem) return;

        if (menuItem.classList.contains('disabled')) return;

        const action = menuItem.dataset.action;

        if (action === 'addToDock' && this.callbacks?.onAddToDock) {
            this.callbacks.onAddToDock(this.currentItem);
        } else if (action === 'removeFromDock' && this.callbacks?.onRemoveFromDock) {
            this.callbacks.onRemoveFromDock(this.currentItem);
        } else if (action === 'edit' && this.callbacks?.onEdit) {
            this.callbacks.onEdit(this.currentItem);
        } else if (action === 'delete' && this.callbacks?.onDelete) {
            this.callbacks.onDelete(this.currentItem);
        } else if (action === 'renameFolder' && this.callbacks?.onRenameFolder) {
            this.callbacks.onRenameFolder(this.currentItem);
        } else if (action === 'dissolveFolder' && this.callbacks?.onDissolveFolder) {
            this.callbacks.onDissolveFolder(this.currentItem);
        } else if (action === 'deleteFolder' && this.callbacks?.onDeleteFolder) {
            this.callbacks.onDeleteFolder(this.currentItem);
        } else if (action === 'removeFromFolder' && this.callbacks?.onRemoveFromFolder) {
            this.callbacks.onRemoveFromFolder(this.currentItem);
        } else if (action === 'createFolder' && this.callbacks?.onCreateFolder) {
            this.callbacks.onCreateFolder(this.currentItem);
        }

        this.close();
    }

    _handleWheel() {
        if (this.isOpen) {
            this.close();
        }
    }

    _handleKeydown(e) {
        if (!this.isOpen || !this.element) return;

        const items = Array.from(
            this.element.querySelectorAll('.context-menu-item:not(.disabled)')
        );
        if (items.length === 0) return;

        const current = document.activeElement;
        const currentIndex = items.indexOf(current);

        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault();
                const nextIndex = currentIndex < items.length - 1 ? currentIndex + 1 : 0;
                items[nextIndex]?.focus();
                break;

            case 'ArrowUp':
                e.preventDefault();
                const prevIndex = currentIndex > 0 ? currentIndex - 1 : items.length - 1;
                items[prevIndex]?.focus();
                break;

            case 'Home':
                e.preventDefault();
                items[0]?.focus();
                break;

            case 'End':
                e.preventDefault();
                items[items.length - 1]?.focus();
                break;

            case 'Enter':
            case ' ':
                if (current && items.includes(current)) {
                    e.preventDefault();
                    current.click();
                }
                break;

            case 'Tab':
                e.preventDefault();
                this.close();
                break;
        }
    }

    _renderContent() {
        if (!this.element) return;
        const content = this.element.querySelector('.context-menu-content');
        if (!content) return;

        const item = this.currentItem;
        const isPinned = item?._id ? store.isPinned(item._id) : false;
        const canPin = store.hasDockCapacity();

        content.innerHTML = this._buildMenuInnerHtml({ isPinned, canPin });
    }

    _buildMenuInnerHtml({ isPinned, canPin }) {
        const item = this.currentItem;
        const isSystemItem = item?.isSystemItem === true;
        const isFolder = item?.type === 'folder';

        const btn = ({ action, label, danger = false, disabled = false, icon = '' }) => {
            const cls = ['context-menu-item'];
            if (danger) cls.push('danger');
            if (disabled) cls.push('disabled');
            return `
                <button class="${cls.join(' ')}" data-action="${action}"
                        role="menuitem" tabindex="-1" ${disabled ? 'aria-disabled="true"' : ''}>
                    ${icon ? icon : ''}
                    <span>${label}</span>
                </button>
            `;
        };

        const sep = () => `<div class="context-menu-separator"></div>`;

        const ICON_EDIT = `
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
        `;
        const ICON_DELETE = `
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="3 6 5 6 21 6"/>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
            </svg>
        `;
        const ICON_PLUS = `
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <line x1="12" y1="5" x2="12" y2="19"/>
                <line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
        `;
        const ICON_X = `
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M18 6L6 18"/>
                <path d="M6 6l12 12"/>
            </svg>
        `;
        const ICON_FOLDER = `
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
            </svg>
        `;
        const ICON_UNGROUP = `
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="2" y="7" width="20" height="14" rx="2" ry="2"/>
                <path d="M16 2v4"/>
                <path d="M8 2v4"/>
            </svg>
        `;

        // Folder context menu
        if (isFolder) {
            return [
                btn({ action: 'renameFolder', label: t('contextRenameFolder'), icon: ICON_EDIT }),
                sep(),
                btn({ action: 'dissolveFolder', label: t('contextDissolveFolder'), icon: ICON_UNGROUP }),
                btn({ action: 'deleteFolder', label: t('contextDeleteFolder'), danger: true, icon: ICON_DELETE })
            ].join('');
        }

        // Items inside a folder overlay — show "remove from folder" callback if provided
        const hasRemoveFromFolder = typeof this.callbacks?.onRemoveFromFolder === 'function';

        if (isSystemItem) {
            if (this.source === 'dock') {
                return [btn({ action: 'removeFromDock', label: t('contextRemoveFromDock'), icon: ICON_X })].join('');
            }

            return [
                isPinned
                    ? btn({ action: 'removeFromDock', label: t('contextRemoveFromDock'), icon: ICON_X })
                    : btn({
                        action: 'addToDock',
                        label: canPin ? t('contextAddToDock') : t('contextAddToDockFull'),
                        disabled: !canPin,
                        icon: ICON_PLUS
                    })
            ].join('');
        }

        if (this.source === 'dock') {
            return [
                btn({ action: 'removeFromDock', label: t('contextRemoveFromDock'), icon: ICON_X }),
                sep(),
                btn({ action: 'edit', label: t('contextEdit'), icon: ICON_EDIT }),
                btn({ action: 'delete', label: t('contextDeletePermanent'), danger: true, icon: ICON_DELETE })
            ].join('');
        } else {
            const items = [
                isPinned
                    ? btn({ action: 'removeFromDock', label: t('contextRemoveFromDock'), icon: ICON_X })
                    : btn({
                        action: 'addToDock',
                        label: canPin ? t('contextAddToDock') : t('contextAddToDockFull'),
                        disabled: !canPin,
                        icon: ICON_PLUS
                    }),
                sep(),
                btn({ action: 'edit', label: t('contextEdit'), icon: ICON_EDIT })
            ];

            if (hasRemoveFromFolder) {
                items.push(btn({ action: 'removeFromFolder', label: t('contextRemoveFromFolder'), icon: ICON_FOLDER }));
            }

            if (!hasRemoveFromFolder && !isSystemItem) {
                items.push(btn({ action: 'createFolder', label: t('contextCreateFolder'), icon: ICON_FOLDER }));
            }

            items.push(btn({ action: 'delete', label: t('contextDelete'), danger: true, icon: ICON_DELETE }));
            return items.join('');
        }
    }

    destroy() {
        if (this._destroyed) return;

        this.close();

        this._destroyed = true;

        document.removeEventListener('wheel', this._boundHandleWheel);
        document.removeEventListener('keydown', this._boundHandleKeydown);

        if (this.element) {
            this.element.removeEventListener('click', this._boundHandleItemClick);
        }

        this._initialized = false;
    }
}

export const contextMenu = new ContextMenu();


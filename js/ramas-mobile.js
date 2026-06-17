(() => {
    const state = {
        currentPage: 1,
        supervisor: '',
        operario: '',
        inspector: '',
        maquina: '',
        tipo: '',
        proceso: '',
        motivo: '',
        subMotivo: '',
        records: [],
        filteredRecords: [],
        currentQuery: '',
        selectedIds: new Set(),
        toastTimer: null,
        syncing: false,
        editMode: false,
        editPassIndex: -1
    };

    function getPrefix() {
        return state.tipo === 'CRUDO' ? 'rama_crudo' : 'rama_tenido';
    }

    function calculateTurno() {
        const h = new Date().getHours();
        return (h >= 7 && h < 19) ? '1T' : '2T';
    }

    // --- Helpers de pases (valores separados por coma) ---

    function parsePassValues(fieldValue) {
        const raw = String(fieldValue || '').trim();
        if (!raw) return [];
        return raw.split(',').map(v => v.trim());
    }

    function getPassCount(record) {
        const prefix = getPrefix();
        return parsePassValues(record[`${prefix}_inicio`]).filter(Boolean).length;
    }

    function getFinCount(record) {
        const prefix = getPrefix();
        return parsePassValues(record[`${prefix}_fin`]).filter(Boolean).length;
    }

    function hasOpenPass(record) {
        return getPassCount(record) > getFinCount(record);
    }

    function appendPassValue(existing, newValue) {
        const current = String(existing || '').trim();
        return current ? `${current},${newValue}` : String(newValue);
    }

    // --- Toast ---

    function showToast(message) {
        const toast = document.getElementById('ramas-toast');
        if (!toast) return;
        toast.textContent = message;
        toast.classList.remove('hidden');
        if (state.toastTimer) clearTimeout(state.toastTimer);
        state.toastTimer = setTimeout(() => toast.classList.add('hidden'), 3200);
    }

    // --- Barra de resumen ---

    function updateSummaryStrip() {
        const strip = document.getElementById('ramas-summary-strip');
        const chipsEl = document.getElementById('ramas-summary-chips');
        if (!strip || !chipsEl) return;

        if (state.currentPage <= 1) {
            strip.classList.add('hidden');
            return;
        }
        strip.classList.remove('hidden');

        const chips = [];
        const personalParts = [state.supervisor, state.operario, state.inspector].filter(Boolean);
        if (personalParts.length) chips.push({ label: personalParts.join(' | '), page: 1 });
        if (state.maquina && state.currentPage >= 3) chips.push({ label: state.maquina, page: 2 });
        if (state.tipo && state.currentPage >= 4) chips.push({ label: state.tipo, page: 3 });
        if (state.tipo === 'ACABADO' && state.proceso && state.currentPage >= 5) chips.push({ label: state.proceso, page: 4 });
        if (state.motivo && state.currentPage >= 6) {
            const motivoLabel = state.subMotivo ? `${state.motivo} · ${state.subMotivo}` : state.motivo;
            chips.push({ label: motivoLabel, page: 5 });
        }

        chipsEl.innerHTML = chips.map(({ label, page }) => `
            <button type="button" class="summary-chip" data-back-to="${page}">
                ${TintoreriaUtils.escapeHtml(label)}
            </button>
        `).join('');
    }

    // --- Navegación ---

    function goToPage(pageNum) {
        const targetSection = document.getElementById(`ramas-page-${pageNum}`);
        if (targetSection) {
            targetSection.querySelectorAll('.option-button-selected').forEach(btn => btn.classList.remove('option-button-selected'));
        }
        document.querySelectorAll('.wizard-page').forEach((section, idx) => {
            section.classList.toggle('hidden', idx + 1 !== pageNum);
        });
        state.currentPage = pageNum;
        updateSummaryStrip();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    // --- Página 1: Personal ---

    function handlePage1Submit(event) {
        event.preventDefault();
        const supervisorEl = document.getElementById('ramas-supervisor');
        const operarioEl = document.getElementById('ramas-operario');
        const inspectorEl = document.getElementById('ramas-inspector');

        const supervisor = supervisorEl ? supervisorEl.value.trim() : '';
        const operarioRaw = operarioEl ? operarioEl.value.trim() : '';
        const inspectorRaw = inspectorEl ? inspectorEl.value.trim() : '';

        if (!supervisor) { showToast('Selecciona un supervisor.'); return; }
        if (!operarioRaw) { showToast('Ingresa el nombre del operario.'); return; }
        if (!inspectorRaw) { showToast('Ingresa el nombre del inspector.'); return; }

        const operario = TintoreriaUtils.sanitizePersonName(operarioRaw);
        const inspector = TintoreriaUtils.sanitizePersonName(inspectorRaw);

        if (!TintoreriaUtils.isValidPersonName(operario)) {
            showToast('Operario: solo letras, máximo 2 palabras.');
            return;
        }
        if (!TintoreriaUtils.isValidPersonName(inspector)) {
            showToast('Inspector: solo letras, máximo 2 palabras.');
            return;
        }

        state.supervisor = supervisor;
        state.operario = operario;
        state.inspector = inspector;

        if (operarioEl) operarioEl.value = operario;
        if (inspectorEl) inspectorEl.value = inspector;

        goToPage(2);
    }

    // --- Página 2: Máquina ---

    function handleMaquinaClick(maquina) {
        state.maquina = maquina;
        document.querySelectorAll('[data-maquina]').forEach(btn => {
            btn.classList.toggle('option-button-selected', btn.dataset.maquina === maquina);
        });
        setTimeout(() => goToPage(3), 180);
    }

    // --- Página 3: Tipo ---

    function handleTipoClick(tipo) {
        state.tipo = tipo;
        state.proceso = '';
        state.motivo = '';
        state.subMotivo = '';
        document.querySelectorAll('[data-tipo]').forEach(btn => {
            btn.classList.toggle('option-button-selected', btn.dataset.tipo === tipo);
        });
        setTimeout(() => {
            resetSearchAndSelection();
            // CRUDO salta directo al buscador (página 6); ACABADO va a Proceso (página 4)
            goToPage(tipo === 'ACABADO' ? 4 : 6);
        }, 180);
    }

    // --- Página 4: Proceso ---

    function handleProcesoClick(proceso) {
        state.proceso = proceso;
        state.motivo = '';
        state.subMotivo = '';
        document.querySelectorAll('[data-proceso]').forEach(btn => {
            btn.classList.toggle('option-button-selected', btn.dataset.proceso === proceso);
        });
        setTimeout(() => {
            if (proceso === 'SECADO') {
                // SECADO no lleva motivo: pasa directo al buscador
                resetSearchAndSelection();
                goToPage(6);
            } else {
                // ACABADO o REPROCESO: ir a seleccionar motivo
                prepareMotivoPage(proceso);
                goToPage(5);
            }
        }, 180);
    }

    // --- Página 5: Motivo / Sub-motivo ---

    function prepareMotivoPage(proceso) {
        const acabadoGroup = document.getElementById('ramas-motivo-acabado');
        const reprocesoGroup = document.getElementById('ramas-motivo-reproceso');
        const submotivoSection = document.getElementById('ramas-submotivo-section');
        if (acabadoGroup) acabadoGroup.classList.toggle('hidden', proceso !== 'ACABADO');
        if (reprocesoGroup) reprocesoGroup.classList.toggle('hidden', proceso !== 'REPROCESO');
        if (submotivoSection) submotivoSection.classList.add('hidden');
    }

    function motivoNeedsSubMotivo(motivo) {
        return state.proceso === 'REPROCESO' &&
            (motivo === 'FUERA DE TONO' || motivo === 'FUERA DE MATCHING');
    }

    function handleMotivoClick(motivo) {
        state.motivo = motivo;
        state.subMotivo = '';
        document.querySelectorAll('[data-motivo]').forEach(btn => {
            btn.classList.toggle('option-button-selected', btn.dataset.motivo === motivo);
        });
        document.querySelectorAll('[data-submotivo]').forEach(btn => btn.classList.remove('option-button-selected'));

        const submotivoSection = document.getElementById('ramas-submotivo-section');

        if (motivoNeedsSubMotivo(motivo)) {
            if (submotivoSection) {
                submotivoSection.classList.remove('hidden');
                setTimeout(() => submotivoSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 60);
            }
            return;
        }

        if (submotivoSection) submotivoSection.classList.add('hidden');
        setTimeout(() => {
            resetSearchAndSelection();
            goToPage(6);
        }, 180);
    }

    function handleSubMotivoClick(subMotivo) {
        state.subMotivo = subMotivo;
        document.querySelectorAll('[data-submotivo]').forEach(btn => {
            btn.classList.toggle('option-button-selected', btn.dataset.submotivo === subMotivo);
        });
        setTimeout(() => {
            resetSearchAndSelection();
            goToPage(6);
        }, 180);
    }

    // --- Sync status ---

    function setSyncStatus(message, isError) {
        const el = document.getElementById('ramas-sync-status');
        if (!el) return;
        el.textContent = message;
        el.style.color = isError ? 'var(--danger-text)' : 'var(--muted)';
    }

    // --- Manejo de registros ---

    function setRecords(records) {
        state.records = TintoreriaUtils.sortRecords(
            (records || []).map(r => TintoreriaUtils.defaultRecord(r))
        );
    }

    function findRecord(recordId) {
        return state.records.find(r => String(r.id_registro || '') === String(recordId || '')) || null;
    }

    function mergeUpdatedRecord(updated) {
        if (!updated || !updated.id_registro) return;
        const targetId = String(updated.id_registro);
        state.records = state.records.map(r =>
            String(r.id_registro || '') === targetId
                ? TintoreriaUtils.defaultRecord({ ...r, ...updated })
                : r
        );
    }

    function filterByExactOpPartida(query) {
        const norm = TintoreriaUtils.normalizeOpPartidaSearchValue(query);
        if (!norm) return [];
        return state.records.filter(record => {
            const opPartida = TintoreriaUtils.formatOpPartida(record.op_tela, record.partida);
            return TintoreriaUtils.normalizeOpPartidaSearchValue(opPartida) === norm;
        });
    }

    function getSelectableIds() {
        return state.filteredRecords
            .map(r => String(r.id_registro || ''))
            .filter(Boolean);
    }

    function pruneSelection() {
        const valid = new Set(getSelectableIds());
        const next = new Set();
        state.selectedIds.forEach(id => { if (valid.has(id)) next.add(id); });
        state.selectedIds = next;
    }

    function resetSearchAndSelection() {
        state.currentQuery = '';
        state.filteredRecords = [];
        state.selectedIds = new Set();
        const searchInput = document.getElementById('ramas-search');
        if (searchInput) searchInput.value = '';
        renderResults();
        hideFormCard();
    }

    // --- Estado visual por pases ---

    function getStatusInfo(record) {
        const prefix = getPrefix();
        const passCount = parsePassValues(record[`${prefix}_inicio`]).filter(Boolean).length;
        const finCount = parsePassValues(record[`${prefix}_fin`]).filter(Boolean).length;
        const open = passCount > finCount;

        if (open) {
            return { label: 'En proceso', pillClass: 'status-in-progress' };
        }
        if (passCount > 0) {
            const label = passCount === 1 ? '1 pase ✓' : `${passCount} pases ✓`;
            return { label, pillClass: 'status-registered' };
        }
        return { label: 'Pendiente', pillClass: 'status-pending' };
    }

    // --- Historial de pases en tarjeta ---

    function buildPassesHtml(record) {
        const prefix = getPrefix();
        const inicios = parsePassValues(record[`${prefix}_inicio`]).filter(Boolean);
        if (!inicios.length) return '';

        const fines = parsePassValues(record[`${prefix}_fin`]);

        const lines = inicios.map((inicio, i) => {
            const fin = fines[i] || '';
            const isOpen = !fin;
            const timeLabel = fin
                ? `${TintoreriaUtils.escapeHtml(inicio)} → ${TintoreriaUtils.escapeHtml(fin)}`
                : `${TintoreriaUtils.escapeHtml(inicio)} → en curso...`;

            return `<div class="pass-line${isOpen ? ' pass-line-open' : ''}">
                <strong>Pase ${i + 1}</strong>
                <span class="pass-time${isOpen ? ' pass-time-open' : ''}">${timeLabel}</span>
            </div>`;
        });

        return `<div class="record-passes">${lines.join('')}</div>`;
    }

    function buildEditButtonsHtml(record) {
        const passCount = getPassCount(record);
        if (passCount === 0 || hasOpenPass(record)) return '';

        const recordId = TintoreriaUtils.escapeHtml(String(record.id_registro || ''));
        const pencilSvg = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zm17.71-10.25c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>`;

        const buttons = [];
        for (let i = 0; i < passCount; i++) {
            const label = passCount === 1 ? 'Editar pase' : `Editar pase ${i + 1}`;
            buttons.push(`<button type="button" class="edit-pass-btn" data-edit-record-id="${recordId}" data-edit-pass-index="${i}">${pencilSvg} ${TintoreriaUtils.escapeHtml(label)}</button>`);
        }
        return `<div class="record-edit-buttons">${buttons.join('')}</div>`;
    }

    // --- Renderizado de resultados ---

    function renderResults() {
        const resultList = document.getElementById('ramas-results');
        const resultSummary = document.getElementById('ramas-result-summary');
        const selectAllBtn = document.getElementById('ramas-select-all');

        if (!resultList || !resultSummary) return;

        if (!state.currentQuery) {
            state.filteredRecords = [];
            state.selectedIds = new Set();
            resultSummary.textContent = 'Ingresa una OP-PTDA para comenzar.';
            resultList.innerHTML = '<div class="empty-state">Ingresa una OP-PTDA para ver coincidencias.</div>';
            if (selectAllBtn) selectAllBtn.classList.add('hidden');
            hideFormCard();
            return;
        }

        state.filteredRecords = filterByExactOpPartida(state.currentQuery);
        pruneSelection();

        if (!state.filteredRecords.length) {
            resultSummary.textContent = 'No se encontraron filas para esa OP-PTDA.';
            resultList.innerHTML = '<div class="empty-state">No se encontraron coincidencias exactas para la OP-PTDA ingresada.</div>';
            if (selectAllBtn) selectAllBtn.classList.add('hidden');
            return;
        }

        const selectableIds = getSelectableIds();
        const selectedCount = selectableIds.filter(id => state.selectedIds.has(id)).length;

        resultSummary.textContent = '';

        if (selectAllBtn) {
            selectAllBtn.classList.toggle('hidden', selectableIds.length === 0);
            selectAllBtn.textContent = (selectableIds.length > 0 && selectedCount === selectableIds.length)
                ? 'Limpiar seleccion'
                : 'Seleccionar todo';
        }

        resultList.innerHTML = state.filteredRecords.map(record => {
            const recordId = String(record.id_registro || '');
            const checked = state.selectedIds.has(recordId);
            const status = getStatusInfo(record);
            const color = TintoreriaUtils.escapeHtml(TintoreriaUtils.formatColorLabel(record.color || 'Sin color'));
            const article = TintoreriaUtils.escapeHtml(record.articulo || 'Sin articulo');
            const ruta = TintoreriaUtils.escapeHtml(record.ruta || '—');
            const clienteOp = TintoreriaUtils.escapeHtml(
                `${record.cliente || 'Sin cliente'} - ${TintoreriaUtils.formatOpPartida(record.op_tela, record.partida)}`
            );
            const passesHtml = buildPassesHtml(record);
            const editButtonsHtml = buildEditButtonsHtml(record);

            const cardClass = [
                'record-card record-card-selectable',
                checked ? 'record-card-selected' : ''
            ].filter(Boolean).join(' ');

            return `
                <article class="${cardClass}" data-record-id="${TintoreriaUtils.escapeHtml(recordId)}">
                    <div class="record-head">
                        <div class="record-title">${clienteOp}</div>
                        <span class="status-pill ${status.pillClass}">${TintoreriaUtils.escapeHtml(status.label)}</span>
                    </div>
                    <div class="record-detail-line"><strong>${color}</strong><span>${article}</span></div>
                    <div class="record-meta">
                        <div class="meta-line">
                            <strong>Kg(crudo):</strong> ${TintoreriaUtils.escapeHtml(String(record.peso_kg_crudo || '0'))}
                            <span class="meta-separator">|</span>
                            <strong>Ruta:</strong> ${ruta}
                        </div>
                    </div>
                    ${passesHtml}
                    ${editButtonsHtml}
                    <div class="select-row">
                        <label class="checkbox-label">
                            <input type="checkbox" class="ramas-checkbox" data-record-id="${TintoreriaUtils.escapeHtml(recordId)}" ${checked ? 'checked' : ''}>
                            Seleccionar
                        </label>
                    </div>
                </article>
            `;
        }).join('');

        if (selectedCount > 0) {
            showFormCard(selectedCount);
        } else {
            hideFormCard();
        }
    }

    // --- Tarjeta de registro ---

    function showFormCard(selectedCount) {
        const formCard = document.getElementById('ramas-form-card');
        if (!formCard) return;

        // Siempre arrancar en modo normal (por si se viene de edit mode)
        const actionButtons = document.getElementById('ramas-action-buttons');
        const editModeActions = document.getElementById('ramas-edit-mode-actions');
        if (actionButtons) actionButtons.classList.remove('hidden');
        if (editModeActions) editModeActions.classList.add('hidden');

        const summaryEl = document.getElementById('ramas-record-summary');
        if (summaryEl) {
            summaryEl.textContent = selectedCount === 1
                ? '1 registro seleccionado.'
                : `${selectedCount} registros seleccionados.`;
        }

        const turnoEl = document.getElementById('ramas-turno');
        if (turnoEl) turnoEl.value = calculateTurno();

        if (selectedCount === 1) {
            const [recordId] = Array.from(state.selectedIds);
            const record = findRecord(recordId);
            if (record) {
                const open = hasOpenPass(record);
                const prefix = getPrefix();

                if (open) {
                    // Pre-cargar con el último valor de cada campo del pase abierto
                    const fieldMap = {
                        'ramas-field-temperatura':  `${prefix}_temperatura`,
                        'ramas-field-velocidad':    `${prefix}_velocidad`,
                        'ramas-field-alimentacion': `${prefix}_alimentacion`,
                        'ramas-field-ancho-cadena': `${prefix}_ancho_de_cadena`,
                        'ramas-field-ancho':        `${prefix}_ancho`,
                        'ramas-field-densidad':     `${prefix}_densidad`,
                        'ramas-field-observaciones':`${prefix}_observaciones`
                    };
                    Object.entries(fieldMap).forEach(([htmlId, fieldName]) => {
                        const el = document.getElementById(htmlId);
                        if (!el) return;
                        const values = parsePassValues(record[fieldName]);
                        el.value = values.length ? values[values.length - 1] : '';
                    });
                } else {
                    clearFormFields();
                }

                syncAllFilledStates();
                updateActionButtons(open);

                formCard.classList.remove('hidden');
                return;
            }
        }

        // Múltiples registros: limpiar y calcular estado mixto
        clearFormFields();
        const selectedRecords = Array.from(state.selectedIds).map(id => findRecord(id)).filter(Boolean);
        const anyOpen = selectedRecords.some(r => hasOpenPass(r));
        const anyNotOpen = selectedRecords.some(r => !hasOpenPass(r));
        updateActionButtonsMixed(anyOpen, anyNotOpen);
        formCard.classList.remove('hidden');
    }

    function updateActionButtons(hasOpen) {
        const inicioBtn = document.getElementById('ramas-inicio-btn');
        const finBtn = document.getElementById('ramas-fin-btn');

        if (inicioBtn) {
            if (hasOpen) {
                inicioBtn.textContent = '✓ En proceso';
                inicioBtn.disabled = true;
                inicioBtn.classList.add('button-done');
            } else {
                inicioBtn.textContent = 'INICIO';
                inicioBtn.disabled = false;
                inicioBtn.classList.remove('button-done');
            }
        }

        if (finBtn) {
            if (hasOpen) {
                finBtn.textContent = 'FIN';
                finBtn.disabled = false;
                finBtn.classList.remove('button-done');
            } else {
                finBtn.textContent = '— FIN —';
                finBtn.disabled = true;
                finBtn.classList.add('button-done');
            }
        }
    }

    function updateActionButtonsMixed(anyOpen, anyNotOpen) {
        const inicioBtn = document.getElementById('ramas-inicio-btn');
        const finBtn = document.getElementById('ramas-fin-btn');

        if (inicioBtn) {
            inicioBtn.textContent = 'INICIO';
            inicioBtn.disabled = !anyNotOpen;
            inicioBtn.classList.toggle('button-done', !anyNotOpen);
        }
        if (finBtn) {
            finBtn.textContent = 'FIN';
            finBtn.disabled = !anyOpen;
            finBtn.classList.toggle('button-done', !anyOpen);
        }
    }

    const FORM_FIELD_IDS = [
        'ramas-field-temperatura', 'ramas-field-velocidad',
        'ramas-field-alimentacion', 'ramas-field-ancho-cadena',
        'ramas-field-ancho', 'ramas-field-densidad', 'ramas-field-observaciones'
    ];

    const FILLED_FIELD_IDS = [
        'ramas-field-temperatura', 'ramas-field-velocidad',
        'ramas-field-alimentacion', 'ramas-field-ancho-cadena',
        'ramas-field-ancho', 'ramas-field-densidad'
    ];

    function syncFilledState(el) {
        if (!el) return;
        el.classList.toggle('mobile-input--filled', String(el.value || '').trim() !== '');
    }

    function syncAllFilledStates() {
        FILLED_FIELD_IDS.forEach(id => syncFilledState(document.getElementById(id)));
    }

    function clearFormFields() {
        FORM_FIELD_IDS.forEach(id => {
            const el = document.getElementById(id);
            if (el) { el.value = ''; syncFilledState(el); }
        });
    }

    function hideFormCard() {
        state.editMode = false;
        state.editPassIndex = -1;
        const formCard = document.getElementById('ramas-form-card');
        if (formCard) formCard.classList.add('hidden');
        const editModeActions = document.getElementById('ramas-edit-mode-actions');
        if (editModeActions) editModeActions.classList.add('hidden');
        const actionButtons = document.getElementById('ramas-action-buttons');
        if (actionButtons) actionButtons.classList.remove('hidden');
    }

    // --- Selección ---

    function updateSelected(recordId, checked) {
        if (!recordId) return;
        if (checked) { state.selectedIds.add(recordId); } else { state.selectedIds.delete(recordId); }
        renderResults();
    }

    function toggleSelected(recordId) {
        if (!recordId) return;
        updateSelected(recordId, !state.selectedIds.has(recordId));
    }

    function toggleSelectAll() {
        const selectableIds = getSelectableIds();
        if (!selectableIds.length) return;
        const allSelected = selectableIds.every(id => state.selectedIds.has(id));
        if (allSelected) {
            selectableIds.forEach(id => state.selectedIds.delete(id));
        } else {
            selectableIds.forEach(id => state.selectedIds.add(id));
        }
        renderResults();
    }

    function handleResultChange(event) {
        const target = event.target;
        if (!(target instanceof HTMLInputElement)) return;
        if (!target.classList.contains('ramas-checkbox')) return;
        updateSelected(target.dataset.recordId || '', target.checked);
    }

    function handleResultClick(event) {
        const target = event.target;
        if (!(target instanceof Element)) return;
        if (target.closest('.checkbox-label') || target.classList.contains('ramas-checkbox')) return;
        if (target.closest('.edit-pass-btn')) return;
        const card = target.closest('.record-card-selectable');
        if (!card) return;
        toggleSelected(card.getAttribute('data-record-id') || '');
    }

    function search(query) {
        state.currentQuery = String(query || '').trim().toUpperCase();
        state.selectedIds = new Set();
        hideFormCard();
        renderResults();
    }

    // --- Recolección de valores del formulario ---

    function collectFormValues() {
        const prefix = getPrefix();
        return {
            [`${prefix}_temperatura`]:     String((document.getElementById('ramas-field-temperatura') || {}).value || ''),
            [`${prefix}_velocidad`]:       String((document.getElementById('ramas-field-velocidad') || {}).value || ''),
            [`${prefix}_alimentacion`]:    String((document.getElementById('ramas-field-alimentacion') || {}).value || ''),
            [`${prefix}_ancho_de_cadena`]: String((document.getElementById('ramas-field-ancho-cadena') || {}).value || ''),
            [`${prefix}_ancho`]:           String((document.getElementById('ramas-field-ancho') || {}).value || ''),
            [`${prefix}_densidad`]:        String((document.getElementById('ramas-field-densidad') || {}).value || ''),
            [`${prefix}_observaciones`]:   String((document.getElementById('ramas-field-observaciones') || {}).value || '')
        };
    }

    // --- Validaciones ---

    function validateInicioFields() {
        const required = [
            { id: 'ramas-field-temperatura',  label: 'Temp (°C)' },
            { id: 'ramas-field-velocidad',    label: 'Velocidad' },
            { id: 'ramas-field-alimentacion', label: 'Alimentación' },
            { id: 'ramas-field-ancho-cadena', label: 'Ancho cadena' }
        ];
        return required
            .filter(f => { const el = document.getElementById(f.id); return !el || !String(el.value || '').trim(); })
            .map(f => f.label);
    }

    function validateFinFields() {
        const required = [
            { id: 'ramas-field-temperatura',  label: 'Temp (°C)' },
            { id: 'ramas-field-velocidad',    label: 'Velocidad' },
            { id: 'ramas-field-alimentacion', label: 'Alimentación' },
            { id: 'ramas-field-ancho-cadena', label: 'Ancho cadena' },
            { id: 'ramas-field-ancho',        label: 'Ancho(cm)' },
            { id: 'ramas-field-densidad',     label: 'Densidad(g/m2)' }
        ];
        return required
            .filter(f => { const el = document.getElementById(f.id); return !el || !String(el.value || '').trim(); })
            .map(f => f.label);
    }

    // --- Botón INICIO ---

    async function handleInicio() {
        const selectedIds = Array.from(state.selectedIds);
        if (!selectedIds.length) { showToast('Selecciona al menos un registro.'); return; }

        const missing = validateInicioFields();
        if (missing.length) {
            showToast(`Completa los campos requeridos: ${missing.join(', ')}.`);
            return;
        }

        const prefix = getPrefix();
        const turno = calculateTurno();
        const inicioTimestamp = TintoreriaUtils.formatProcessDateTime(new Date());
        const formValues = collectFormValues();

        const updates = selectedIds
            .map(id => {
                const record = findRecord(id);
                if (!record || hasOpenPass(record)) return null;
                const changes = {
                    [`${prefix}_supervisor`]: appendPassValue(record[`${prefix}_supervisor`], state.supervisor),
                    [`${prefix}_operario`]:   appendPassValue(record[`${prefix}_operario`], state.operario),
                    [`${prefix}_inspector`]:  appendPassValue(record[`${prefix}_inspector`], state.inspector),
                    [`${prefix}_maquina`]:    appendPassValue(record[`${prefix}_maquina`], state.maquina),
                    [`${prefix}_turno`]:      appendPassValue(record[`${prefix}_turno`], turno),
                    [`${prefix}_inicio`]:     appendPassValue(record[`${prefix}_inicio`], inicioTimestamp),
                    [`${prefix}_estado`]:     'PROG',
                    'plegado_estado':         'OK'
                };
                if (state.tipo === 'ACABADO') {
                    changes['rama_crudo_estado'] = 'OK';
                    changes['preparado_estado']  = 'OK';
                    changes['tenido_estado']     = 'OK';
                    changes['abridora_estado']   = 'OK';
                    changes['secado_estado']     = 'OK';
                    changes[`${prefix}_proceso`]    = appendPassValue(record[`${prefix}_proceso`], state.proceso);
                    changes[`${prefix}_motivo`]     = appendPassValue(record[`${prefix}_motivo`], state.motivo);
                    changes[`${prefix}_sub_motivo`] = appendPassValue(record[`${prefix}_sub_motivo`], state.subMotivo);
                }
                Object.entries(formValues).forEach(([field, value]) => {
                    changes[field] = appendPassValue(record[field], value);
                });
                return { id_registro: id, changes };
            })
            .filter(Boolean);

        if (!updates.length) {
            showToast('Los registros seleccionados ya tienen un pase abierto. Registra el FIN primero.');
            return;
        }

        const inicioBtn = document.getElementById('ramas-inicio-btn');
        if (inicioBtn) { inicioBtn.disabled = true; inicioBtn.textContent = 'Guardando...'; }

        try {
            const response = await TintoreriaAPI.updateRecords(updates);
            if (response && Array.isArray(response.records)) {
                response.records.forEach(r => mergeUpdatedRecord(r));
            }
            showToast(`Inicio registrado en ${updates.length} fila(s).`);
            state.tipo = '';
            state.proceso = '';
            state.motivo = '';
            state.subMotivo = '';
            goToPage(3);
            resetSearchAndSelection();
        } catch (error) {
            showToast(error && error.message ? error.message : 'No se pudo registrar el inicio.');
            if (inicioBtn) { inicioBtn.disabled = false; inicioBtn.textContent = 'INICIO'; }
        }
    }

    // --- Modal: siguiente paso al terminar ACABADA ---

    function showFinModal() {
        const modal = document.getElementById('ramas-fin-modal');
        const screen1 = document.getElementById('ramas-fin-modal-screen1');
        const screen2 = document.getElementById('ramas-fin-modal-screen2');
        if (!modal) return;
        if (screen1) screen1.classList.remove('hidden');
        if (screen2) screen2.classList.add('hidden');
        modal.classList.remove('hidden');
    }

    function hideFinModal() {
        const modal = document.getElementById('ramas-fin-modal');
        if (modal) modal.classList.add('hidden');
    }

    function showFinModalScreen2() {
        const screen1 = document.getElementById('ramas-fin-modal-screen1');
        const screen2 = document.getElementById('ramas-fin-modal-screen2');
        if (screen1) screen1.classList.add('hidden');
        if (screen2) screen2.classList.remove('hidden');
    }

    function showFinModalScreen1() {
        const screen1 = document.getElementById('ramas-fin-modal-screen1');
        const screen2 = document.getElementById('ramas-fin-modal-screen2');
        if (screen1) screen1.classList.remove('hidden');
        if (screen2) screen2.classList.add('hidden');
    }

    // --- Botón FIN ---

    async function handleFin() {
        const selectedIds = Array.from(state.selectedIds);
        if (!selectedIds.length) { showToast('Selecciona al menos un registro.'); return; }

        const missing = validateFinFields();
        if (missing.length) {
            showToast(`Completa los campos requeridos: ${missing.join(', ')}.`);
            return;
        }

        if (state.tipo === 'ACABADO') {
            showFinModal();
            return;
        }

        await executeFinSave(null);
    }

    // acabadoDecision: null | { tipo: string, estado: string }
    async function executeFinSave(acabadoDecision) {
        hideFinModal();

        const selectedIds = Array.from(state.selectedIds);
        const prefix = getPrefix();
        const finTimestamp = TintoreriaUtils.formatProcessDateTime(new Date());
        const formValues = collectFormValues();

        const updates = selectedIds
            .map(id => {
                const record = findRecord(id);
                if (!record || !hasOpenPass(record)) return null;
                const changes = {
                    [`${prefix}_fin`]:    appendPassValue(record[`${prefix}_fin`], finTimestamp),
                    [`${prefix}_estado`]: 'OK'
                };
                Object.entries(formValues).forEach(([field, value]) => {
                    const existing = parsePassValues(record[field]);
                    if (existing.length > 0) {
                        existing[existing.length - 1] = value;
                        changes[field] = existing.join(',');
                    } else {
                        changes[field] = value;
                    }
                });
                if (acabadoDecision) {
                    changes['acabado_especial_tipo'] = acabadoDecision.tipo;
                    changes['acabado_especial_estado'] = acabadoDecision.estado;
                }
                return { id_registro: id, changes };
            })
            .filter(Boolean);

        if (!updates.length) {
            showToast('Los registros seleccionados no tienen un pase abierto para cerrar.');
            return;
        }

        const finBtn = document.getElementById('ramas-fin-btn');
        if (finBtn) { finBtn.disabled = true; finBtn.textContent = 'Guardando...'; }

        try {
            const response = await TintoreriaAPI.updateRecords(updates);
            if (response && Array.isArray(response.records)) {
                response.records.forEach(r => mergeUpdatedRecord(r));
            }
            showToast(`Proceso completado en ${updates.length} fila(s).`);
            state.selectedIds = new Set();
            renderResults();
            hideFormCard();
        } catch (error) {
            showToast(error && error.message ? error.message : 'No se pudo registrar el fin.');
            if (finBtn) { finBtn.disabled = false; finBtn.textContent = 'FIN'; }
        }
    }

    // --- Edición de pase existente ---

    function enterEditMode(passIndex) {
        state.editMode = true;
        state.editPassIndex = passIndex;

        const [recordId] = Array.from(state.selectedIds);
        const record = findRecord(recordId);
        if (!record) return;

        const prefix = getPrefix();
        const fieldMap = {
            'ramas-field-temperatura':  `${prefix}_temperatura`,
            'ramas-field-velocidad':    `${prefix}_velocidad`,
            'ramas-field-alimentacion': `${prefix}_alimentacion`,
            'ramas-field-ancho-cadena': `${prefix}_ancho_de_cadena`,
            'ramas-field-ancho':        `${prefix}_ancho`,
            'ramas-field-densidad':     `${prefix}_densidad`,
            'ramas-field-observaciones':`${prefix}_observaciones`
        };

        Object.entries(fieldMap).forEach(([htmlId, fieldName]) => {
            const el = document.getElementById(htmlId);
            if (!el) return;
            const values = parsePassValues(record[fieldName]);
            el.value = values[passIndex] !== undefined ? values[passIndex] : '';
            syncFilledState(el);
        });

        document.getElementById('ramas-action-buttons').classList.add('hidden');
        document.getElementById('ramas-edit-mode-actions').classList.remove('hidden');

        setTimeout(() => {
            const formCard = document.getElementById('ramas-form-card');
            if (formCard) formCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }, 60);
    }

    function exitEditMode() {
        state.editMode = false;
        state.editPassIndex = -1;
        const editModeActions = document.getElementById('ramas-edit-mode-actions');
        if (editModeActions) editModeActions.classList.add('hidden');
        showFormCard(state.selectedIds.size);
    }

    async function executeEditSave() {
        const selectedIds = Array.from(state.selectedIds);
        if (selectedIds.length !== 1) return;

        const missing = validateFinFields();
        if (missing.length) {
            showToast(`Completa los campos requeridos: ${missing.join(', ')}.`);
            return;
        }

        const recordId = selectedIds[0];
        const record = findRecord(recordId);
        if (!record) return;

        const prefix = getPrefix();
        const passIndex = state.editPassIndex;
        const formValues = collectFormValues();

        const changes = {};
        Object.entries(formValues).forEach(([field, value]) => {
            const existing = parsePassValues(record[field]);
            if (existing.length > passIndex) {
                existing[passIndex] = value;
                changes[field] = existing.join(',');
            }
        });

        if (!Object.keys(changes).length) {
            showToast('No hay cambios para guardar.');
            return;
        }

        const saveBtn = document.getElementById('ramas-save-edit-btn');
        const cancelBtn = document.getElementById('ramas-cancel-edit-btn');
        if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Guardando...'; }
        if (cancelBtn) cancelBtn.disabled = true;

        try {
            const response = await TintoreriaAPI.updateRecords([{ id_registro: recordId, changes }]);
            if (response && Array.isArray(response.records)) {
                response.records.forEach(r => mergeUpdatedRecord(r));
            }
            showToast('Pase editado correctamente.');
            exitEditMode();
        } catch (error) {
            showToast(error && error.message ? error.message : 'No se pudo guardar la edición.');
            if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Guardar cambios'; }
            if (cancelBtn) cancelBtn.disabled = false;
        }
    }

    // --- Estado visual: campo lleno / vacío ---

    function bindFilledStateListeners() {
        FILLED_FIELD_IDS.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.addEventListener('input', () => syncFilledState(el));
        });
    }

    // --- Bloqueo de coma en todos los inputs ---

    function blockCommaOnInput(event) {
        if (event.data && event.data.includes(',')) {
            event.preventDefault();
        }
    }

    function bindCommaBlockers() {
        const ids = [
            'ramas-operario', 'ramas-inspector',
            'ramas-field-temperatura', 'ramas-field-velocidad',
            'ramas-field-alimentacion', 'ramas-field-ancho-cadena',
            'ramas-field-ancho', 'ramas-field-densidad',
            'ramas-field-observaciones'
        ];
        ids.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.addEventListener('beforeinput', blockCommaOnInput);
        });
    }

    // --- Escáner QR ---

    async function handleScan() {
        const scanBtn = document.getElementById('ramas-scan-button');
        if (!window.TintoreriaQR || typeof TintoreriaQR.scanQrCode !== 'function') {
            showToast('No se encontro el lector QR.');
            return;
        }
        if (scanBtn) scanBtn.disabled = true;
        try {
            const rawValue = await TintoreriaQR.scanQrCode();
            const opPartida = TintoreriaQR.normalizeScannedOpPartida(rawValue);
            const searchInput = document.getElementById('ramas-search');
            if (searchInput) searchInput.value = opPartida;
            search(opPartida);
        } catch (error) {
            const message = error && error.message ? error.message : 'No se pudo escanear el QR.';
            if (message !== 'Escaneo cancelado.') showToast(message);
        } finally {
            if (scanBtn) scanBtn.disabled = false;
        }
    }

    // --- Carga de datos ---

    async function hydrateFromCache() {
        if (!window.TintoreriaAPI || typeof TintoreriaAPI.getCachedRecords !== 'function') return false;
        const cached = TintoreriaAPI.getCachedRecords();
        if (!cached || !Array.isArray(cached.records) || !cached.records.length) return false;
        setRecords(cached.records);
        setSyncStatus(`Cache local (${cached.records.length} registros). Sincronizando...`);
        return true;
    }

    async function refreshRemoteRecords() {
        if (!window.TintoreriaAPI || typeof TintoreriaAPI.listRecords !== 'function') {
            setSyncStatus('No se encontro la API configurada.', true);
            return;
        }
        state.syncing = true;
        setSyncStatus('Sincronizando datos...');
        try {
            const response = await TintoreriaAPI.listRecords();
            setRecords(response.records || []);
            if (state.currentQuery) renderResults();
            setSyncStatus('');
        } catch (error) {
            setSyncStatus(error && error.message ? error.message : 'No se pudo sincronizar.', true);
        } finally {
            state.syncing = false;
        }
    }

    // --- Registro de eventos ---

    function bindEvents() {
        const page1Form = document.getElementById('ramas-page1-form');
        if (page1Form) page1Form.addEventListener('submit', handlePage1Submit);

        document.querySelectorAll('[data-maquina]').forEach(btn => {
            btn.addEventListener('click', () => handleMaquinaClick(btn.dataset.maquina));
        });
        document.querySelectorAll('[data-tipo]').forEach(btn => {
            btn.addEventListener('click', () => handleTipoClick(btn.dataset.tipo));
        });
        document.querySelectorAll('[data-proceso]').forEach(btn => {
            btn.addEventListener('click', () => handleProcesoClick(btn.dataset.proceso));
        });
        document.querySelectorAll('[data-motivo]').forEach(btn => {
            btn.addEventListener('click', () => handleMotivoClick(btn.dataset.motivo));
        });
        document.querySelectorAll('[data-submotivo]').forEach(btn => {
            btn.addEventListener('click', () => handleSubMotivoClick(btn.dataset.submotivo));
        });

        document.addEventListener('click', event => {
            const trigger = event.target.closest('[data-back-to]');
            if (!trigger) return;
            const page = parseInt(trigger.dataset.backTo, 10);
            if (!isNaN(page)) goToPage(page);
        });

        const searchBack = document.getElementById('ramas-search-back');
        if (searchBack) {
            searchBack.addEventListener('click', () => {
                if (state.tipo !== 'ACABADO') { goToPage(3); return; }
                if (state.proceso === 'SECADO') { goToPage(4); return; }
                // ACABADO o REPROCESO: volver a elegir motivo
                prepareMotivoPage(state.proceso);
                goToPage(5);
            });
        }

        const searchForm = document.getElementById('ramas-search-form');
        const searchInput = document.getElementById('ramas-search');
        if (searchForm) {
            searchForm.addEventListener('submit', e => {
                e.preventDefault();
                if (searchInput) search(searchInput.value);
            });
        }
        if (searchInput) {
            searchInput.addEventListener('input', () => search(searchInput.value));
        }

        const resultList = document.getElementById('ramas-results');
        if (resultList) {
            resultList.addEventListener('change', handleResultChange);
            resultList.addEventListener('click', handleResultClick);
        }

        const selectAllBtn = document.getElementById('ramas-select-all');
        if (selectAllBtn) selectAllBtn.addEventListener('click', toggleSelectAll);

        const inicioBtn = document.getElementById('ramas-inicio-btn');
        const finBtn = document.getElementById('ramas-fin-btn');
        if (inicioBtn) inicioBtn.addEventListener('click', handleInicio);
        if (finBtn) finBtn.addEventListener('click', handleFin);

        const scanBtn = document.getElementById('ramas-scan-button');
        if (scanBtn) scanBtn.addEventListener('click', handleScan);

        // --- Botones del modal ACABADA ---
        const finOptCalidad = document.getElementById('ramas-fin-opt-calidad');
        if (finOptCalidad) finOptCalidad.addEventListener('click', () => {
            executeFinSave({ tipo: 'NO LLEVA', estado: 'OK' });
        });

        const finOptRama = document.getElementById('ramas-fin-opt-rama');
        if (finOptRama) finOptRama.addEventListener('click', () => {
            executeFinSave(null);
        });

        const finOptEspecial = document.getElementById('ramas-fin-opt-especial');
        if (finOptEspecial) finOptEspecial.addEventListener('click', showFinModalScreen2);

        const finModalBack = document.getElementById('ramas-fin-modal-back');
        if (finModalBack) finModalBack.addEventListener('click', showFinModalScreen1);

        const finModalCancel = document.getElementById('ramas-fin-modal-cancel');
        if (finModalCancel) finModalCancel.addEventListener('click', hideFinModal);

        document.querySelectorAll('[data-acab-tipo]').forEach(btn => {
            btn.addEventListener('click', () => {
                executeFinSave({ tipo: btn.dataset.acabTipo, estado: 'PROG' });
            });
        });

        document.addEventListener('pointerdown', event => {
            if (!(event.target instanceof Element)) return;
            if (event.target.closest('input, textarea, select, [contenteditable="true"], label, button')) return;
            const active = document.activeElement;
            if (!(active instanceof HTMLElement)) return;
            if (!active.matches('input, textarea, select, [contenteditable="true"]')) return;
            active.blur();
        });

        bindCommaBlockers();
        bindFilledStateListeners();

        // --- Edición de pase (delegado en la lista de resultados) ---
        if (resultList) {
            resultList.addEventListener('click', event => {
                const btn = event.target.closest('.edit-pass-btn');
                if (!btn) return;
                const recordId = btn.dataset.editRecordId || '';
                const passIndex = parseInt(btn.dataset.editPassIndex || '0', 10);
                if (!recordId || isNaN(passIndex)) return;
                state.selectedIds = new Set([recordId]);
                renderResults();
                enterEditMode(passIndex);
            });
        }

        const saveEditBtn = document.getElementById('ramas-save-edit-btn');
        if (saveEditBtn) saveEditBtn.addEventListener('click', executeEditSave);

        const cancelEditBtn = document.getElementById('ramas-cancel-edit-btn');
        if (cancelEditBtn) cancelEditBtn.addEventListener('click', exitEditMode);
    }

    async function init() {
        bindEvents();
        await hydrateFromCache();
        await refreshRemoteRecords();
    }

    document.addEventListener('DOMContentLoaded', init);
})();

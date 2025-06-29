document.addEventListener('DOMContentLoaded', () => {
    // --- 1. SELEÇÃO DE ELEMENTOS DO DOM ---
    const resetButton = document.getElementById('resetButton');
    const tabLinks = document.querySelectorAll('.tab-link');
    const tabContents = document.querySelectorAll('.tab-content');
    const scanButton = document.getElementById('scanButton');
    const unfollowAllButton = document.getElementById('unfollowAllButton');
    const searchInput = document.getElementById('searchInput');
    const cancelButton = document.getElementById('cancel-action-button');

    // Elementos de Status e Progresso no Rodapé
    const statusContainer = document.getElementById('status-container');
    const statusMessage = document.getElementById('status-message');
    const statusIndicator = document.getElementById('status-indicator');

    const sidebarProgressView = document.getElementById('sidebar-progress-view');
    const progressBar = document.getElementById('progress-bar');
    const progressCounter = document.getElementById('progress-counter');
    const progressPercentage = document.getElementById('progress-percentage');
    const progressTimer = document.getElementById('progress-timer');
    const progressStage = document.getElementById('progress-stage');

    const lists = {
        naoSeguidores: document.getElementById('nao-seguidores-list'),
        favoritos: document.getElementById('favoritos-list'),
        naoSigo: document.getElementById('nao-sigo-list'),
    };
    const counts = {
        naoSeguidores: document.getElementById('nao-seguidores-count'),
        favoritos: document.getElementById('favoritos-count'),
        naoSigo: document.getElementById('nao-sigo-count'),
    };

    // --- 2. ESTADO DA APLICAÇÃO ---
    let state = {
        naoSeguidores: [],
        favoritos: [],
        naoSigo: [],
        currentFilter: '',
    };

    let isUnfollowing = false;
    let wasCancelled = false;

    // --- 3. FUNÇÕES DE UTILIDADE E LÓGICA ---
    const updateStatus = (message, status = 'idle') => {
        statusMessage.textContent = message;
        statusIndicator.className = status;
    };

    const setInProgressView = (inProgress) => {
        if (inProgress) {
            statusContainer.style.display = 'none';
            sidebarProgressView.style.display = 'block';
            cancelButton.style.display = 'flex';
            scanButton.style.display = 'none';
        } else {
            sidebarProgressView.style.display = 'none';
            statusContainer.style.display = 'flex';
            cancelButton.style.display = 'none';
            scanButton.style.display = 'flex';
        }
    };

    const delay = (ms) => new Promise(res => setTimeout(res, ms));
    const saveState = async () => await chrome.storage.local.set({ appState: state });

    const loadState = async () => {
        const data = await chrome.storage.local.get('appState');
        if (data.appState) {
            state = data.appState;
            renderAllLists();
            updateStatus('Dados carregados do último uso.');
        } else {
            updateStatus('Pronto para analisar.');
        }
    };

    // --- 4. RENDERIZAÇÃO ---
    // ... (Função createUserItemHTML, renderList e renderAllLists não mudam)
    const createUserItemHTML = (user, listType) => {
        const isFavorited = state.favoritos.some(fav => fav.id === user.id);
        let actionsHTML = '';

        if (listType === 'naoSeguidores') {
            actionsHTML = `
                <button class="action-btn star-btn ${isFavorited ? 'favorited' : ''}" data-userid="${user.id}" title="Favoritar">
                    <i class="fa-${isFavorited ? 'solid' : 'regular'} fa-star"></i>
                </button>
                <button class="action-btn unfollow-btn" data-userid="${user.id}" title="Deixar de Seguir">
                    <i class="fa-solid fa-user-minus"></i>
                </button>
            `;
        } else if (listType === 'favoritos') {
            actionsHTML = `
                <button class="action-btn star-btn favorited" data-userid="${user.id}" title="Remover dos Favoritos">
                    <i class="fa-solid fa-star"></i>
                </button>
            `;
        }

        return `
            <li class="user-item" id="user-${user.id}">
                <img src="${user.picUrl || 'images/icon48.png'}" alt="Foto de ${user.username}" crossOrigin="anonymous">
                <div class="user-info">
                    <a href="https://instagram.com/${user.username}" target="_blank">${user.username}</a>
                    <span>${user.fullName || ''}</span>
                </div>
                <div class="user-actions">${actionsHTML}</div>
            </li>
        `;
    };

    const renderList = (listName) => {
        const listElement = lists[listName];
        const countElement = counts[listName];
        const users = state[listName] || [];
        const filteredUsers = users.filter(user =>
            user.username.toLowerCase().includes(state.currentFilter) ||
            (user.fullName && user.fullName.toLowerCase().includes(state.currentFilter))
        );
        listElement.innerHTML = filteredUsers.map(user => createUserItemHTML(user, listName)).join('');
        countElement.textContent = users.length;
    };

    const renderAllLists = () => {
        renderList('naoSeguidores');
        renderList('favoritos');
        renderList('naoSigo');
        unfollowAllButton.disabled = state.naoSeguidores.length === 0 || isUnfollowing;
    };


    // --- 5. MANIPULADORES DE EVENTOS ---
    cancelButton.addEventListener('click', () => {
        if (isUnfollowing) {
            wasCancelled = true;
        } else {
            chrome.runtime.sendMessage({ action: 'cancelScan' });
        }
    });

    scanButton.addEventListener('click', async () => {
        wasCancelled = false;
        setInProgressView(true); // Mostra a barra de progresso no rodapé
        updateStatus('Iniciando análise...', 'loading');
        try {
            const response = await chrome.runtime.sendMessage({ action: 'startScan' });
            if (!response || !response.success) {
                if (response && response.cancelled) {
                    throw new Error('cancelled');
                }
                throw new Error(response.message || 'Falha ao obter dados.');
            }

            progressStage.textContent = 'Finalizando e comparando listas...';
            const { following, followers } = response.data;

            const followersIds = new Set(followers.map(u => u.id));
            state.naoSeguidores = following.filter(u => !followersIds.has(u.id));

            state.favoritos = state.favoritos.filter(fav => !followersIds.has(fav.id));

            await saveState();
            renderAllLists();
            updateStatus(`Análise concluída: ${state.naoSeguidores.length} não seguidores encontrados.`, 'success');

        } catch (error) {
            if (error.message === 'cancelled') {
                updateStatus('Análise cancelada.', 'idle');
            } else {
                let friendlyMessage = error.message;
                if (error.message.includes("ID de usuário") || error.message.includes("perfil")) {
                    friendlyMessage = "ID/Perfil não encontrado. Se você trocou de conta, recarregue a página (F5) e tente novamente.";
                } else if (error.message.includes("429")) {
                    friendlyMessage = "Muitas requisições. O Instagram pediu uma pausa. Tente novamente em alguns minutos.";
                }
                updateStatus(friendlyMessage, 'error');
            }
        } finally {
            setInProgressView(false); // Esconde a barra de progresso e mostra o status
        }
    });

    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === 'progressUpdate') {
            const { current, total, percentage, timeLeft, stage } = request.data;
            progressBar.style.width = `${percentage}%`;
            progressCounter.textContent = `${current}/${total}`;
            progressPercentage.textContent = `${percentage}%`;
            progressStage.textContent = stage;
            if (timeLeft >= 0) {
                const minutes = Math.floor(timeLeft / 60);
                const seconds = timeLeft % 60;
                progressTimer.textContent = `~${minutes}m ${seconds}s restantes`;
            } else {
                progressTimer.textContent = `~`;
            }
        }
    });

    resetButton.addEventListener('click', async () => {
        if (isUnfollowing) {
            alert("Aguarde o processo de 'Deixar de Seguir' terminar.");
            return;
        }
        if (confirm("Isso irá limpar todos os dados salvos (favoritos, etc.) para permitir a análise de uma nova conta. Deseja continuar?")) {
            await chrome.storage.local.clear();
            location.reload();
        }
    });

    unfollowAllButton.addEventListener('click', async () => {
        const unfollowLimit = 200;
        const totalNaoSeguidores = state.naoSeguidores.length;

        if (totalNaoSeguidores === 0) return;

        const qtdParaUnfollow = Math.min(totalNaoSeguidores, unfollowLimit);
        const confirmationMessage = `Você tem ${totalNaoSeguidores} não-seguidores.\n\nPor segurança, a ferramenta deixará de seguir no máximo ${unfollowLimit} contas por vez.\n\nDeseja deixar de seguir ${qtdParaUnfollow} contas agora?`;

        if (!confirm(confirmationMessage)) return;

        isUnfollowing = true;
        wasCancelled = false;
        scanButton.disabled = true;
        renderAllLists();
        setInProgressView(true); // Mostra a barra de progresso no rodapé

        const usersToUnfollow = state.naoSeguidores.slice(0, qtdParaUnfollow);
        let totalToUnfollowInBatch = usersToUnfollow.length;

        for (let i = 0; i < usersToUnfollow.length; i++) {
            if (wasCancelled) {
                updateStatus('Processo de "Deixar de Seguir" cancelado.', 'idle');
                break;
            }

            const user = usersToUnfollow[i];

            progressStage.textContent = `Deixando de seguir ${user.username}...`;
            progressCounter.textContent = `${i + 1}/${totalToUnfollowInBatch}`;
            const percentage = Math.round(((i + 1) / totalToUnfollowInBatch) * 100);
            progressBar.style.width = `${percentage}%`;
            progressPercentage.textContent = `${percentage}%`;
            progressTimer.textContent = `~`;

            try {
                const response = await chrome.runtime.sendMessage({ action: 'unfollowUser', payload: { userId: user.id } });
                if (response && response.success) {
                    state.naoSeguidores = state.naoSeguidores.filter(u => u.id !== user.id);
                    state.naoSigo.unshift(user);
                } else {
                    throw new Error(response.message || `Falha ao deixar de seguir ${user.username}`);
                }
            } catch (error) {
                updateStatus(error.message, 'error');
                await delay(2000);
            }

            await saveState();
            renderAllLists();

            if (i < usersToUnfollow.length - 1) {
                const randomDelay = Math.random() * 5000 + 10000;
                let secondsLeft = Math.round(randomDelay / 1000);

                for (let s = secondsLeft; s > 0; s--) {
                    if (wasCancelled) break;
                    progressTimer.textContent = `Próxima ação em ${s}s...`;
                    await delay(1000);
                }
                if (wasCancelled) break;
            }
        }

        isUnfollowing = false;
        scanButton.disabled = false;
        setInProgressView(false); // Esconde a barra de progresso

        const totalRestante = state.naoSeguidores.length;
        if (wasCancelled) {
            // a mensagem de cancelamento já foi dada no loop
        } else if (totalRestante > 0) {
            updateStatus(`Lote de ${qtdParaUnfollow} concluído. Clique novamente para processar os ${totalRestante} restantes.`, 'success');
        } else {
            updateStatus("Processo concluído. Você não tem mais não-seguidores.", 'success');
        }

        renderAllLists();
    });

    document.querySelector('.content').addEventListener('click', async (e) => {
        if (isUnfollowing) return;
        const target = e.target.closest('.action-btn');
        if (!target) return;

        const userId = target.dataset.userid;

        if (target.classList.contains('star-btn')) {
            const isFavorited = state.favoritos.some(fav => fav.id === userId);

            if (isFavorited) {
                const userToMove = state.favoritos.find(u => u.id === userId);
                state.favoritos = state.favoritos.filter(u => u.id !== userId);
                state.naoSeguidores.unshift(userToMove);
            } else {
                const userToMove = state.naoSeguidores.find(u => u.id === userId);
                state.naoSeguidores = state.naoSeguidores.filter(u => u.id !== userId);
                state.favoritos.unshift(userToMove);
            }
        }
        else if (target.classList.contains('unfollow-btn')) {
            const user = state.naoSeguidores.find(u => u.id === userId);
            if (!user) return;

            updateStatus(`Deixando de seguir ${user.username}...`, 'loading');
            try {
                const response = await chrome.runtime.sendMessage({ action: 'unfollowUser', payload: { userId: user.id } });
                if (response && response.success) {
                    state.naoSeguidores = state.naoSeguidores.filter(u => u.id !== userId);
                    state.naoSigo.unshift(user);
                    updateStatus(`Sucesso ao deixar de seguir ${user.username}.`, 'success');
                } else {
                    throw new Error(response.message || `Falha ao deixar de seguir ${user.username}`);
                }
            } catch (error) {
                updateStatus(error.message, 'error');
            }
        }

        await saveState();
        renderAllLists();
    });

    searchInput.addEventListener('input', (e) => {
        state.currentFilter = e.target.value.toLowerCase();
        renderAllLists();
    });

    tabLinks.forEach(link => {
        link.addEventListener('click', () => {
            if (isUnfollowing) return;
            const tabId = link.dataset.tab;
            tabLinks.forEach(l => l.classList.remove('active'));
            tabContents.forEach(c => c.classList.remove('active'));
            link.classList.add('active');
            document.getElementById(tabId).classList.add('active');
        });
    });

    // --- 6. INICIALIZAÇÃO ---
    loadState();
});
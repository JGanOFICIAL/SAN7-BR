

let currentContent = null;
let currentBook = null;
let bookmarks = {};


function showMainLibrary() {
    loadBooks();
}

function loadBooks() {
    database.ref('books').on('value', (snapshot) => {
        const books = [];
        snapshot.forEach((child) => {
            books.push({id: child.key, ...child.val()});
        });
        displayBooks(books);
    });
}

function displayBooks(books, searchTerm = '') {
    let filtered = books;
    if (searchTerm) {
        filtered = books.filter(c => 
            c.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
            c.description.toLowerCase().includes(searchTerm.toLowerCase())
        );
    }
    
    document.getElementById('dynamicContent').innerHTML = `
        <div class="search-bar">
            <input type="text" id="searchInput" placeholder="Buscar por título ou descrição..." onkeyup="searchBooks()">
        </div>
        <div class="content-grid" id="contentGrid">
            ${filtered.map(book => `
                <div class="content-card" onclick="viewBook('${book.id}')">
                    <img src="${book.imageUrl}" class="card-image" onerror="this.src='https://via.placeholder.com/300x180?text=Sem+Capa'">
                    <div class="card-content">
                        <h3 class="card-title">${book.title}</h3>
                        <p class="card-description">${book.description.substring(0, 80)}...</p>
                        <span class="content-type type-livro">Livro</span>
                    </div>
                </div>
            `).join('')}
        </div>
    `;
}

function searchBooks() {
    const searchTerm = document.getElementById('searchInput')?.value || '';
    database.ref('books').once('value', (snapshot) => {
        const books = [];
        snapshot.forEach((child) => {
            books.push({id: child.key, ...child.val()});
        });
        displayBooks(books, searchTerm);
    });
}

function viewBook(bookId) {
    database.ref('books/' + bookId).once('value', (snapshot) => {
        const book = {id: bookId, ...snapshot.val()};
        currentBook = book;
        showPages(book);
    });
}

function showPages(book) {
    let pagesHtml = '';
    if (book.pages && book.pages.length > 0) {
        pagesHtml = book.pages.map((page, idx) => `
            <div class="page-viewer" id="page-${idx}">
                <div class="page-header">
                    <h3>Página ${idx + 1}</h3>
                    ${bookmarks[book.id] === idx ? '<span class="bookmark-badge">✓ Página Marcada</span>' : ''}
                </div>
                <div class="page-text-container">
                    <p class="page-text">${page.text}</p>
                </div>
                ${page.images && page.images.length > 0 ? `
                    <div class="page-images">
                        ${page.images.map((img, imgIdx) => `
                            <div class="thumbnail-image" onclick="viewFullImage('${img}')">
                                <img src="${img}" class="thumbnail-img" onerror="this.src='https://via.placeholder.com/100x100?text=Erro'">
                            </div>
                        `).join('')}
                    </div>
                ` : ''}
                <div class="page-actions">
                    <button class="btn btn-small" onclick="markPage(${idx})">
                        ${bookmarks[book.id] === idx ? '✓ Página Marcada' : '📖 Marcar esta Página'}
                    </button>
                </div>
            </div>
        `).join('');
    } else {
        pagesHtml = '<p>Este livro não possui páginas cadastradas.</p>';
    }
    
    document.getElementById('dynamicContent').innerHTML = `
        <button class="btn btn-back" onclick="loadBooks()">← Voltar para Biblioteca</button>
        <div class="book-header">
            <div class="book-cover-large">
                <img src="${book.imageUrl}" onerror="this.src='https://via.placeholder.com/200x280?text=Sem+Capa'">
            </div>
            <div class="book-info-large">
                <h2 class="book-title">${book.title}</h2>
                <p class="book-description">${book.description}</p>
            </div>
        </div>
        <div class="pages-container">
            <h3 class="pages-title">Páginas do Livro</h3>
            ${pagesHtml}
        </div>
    `;
}

function viewFullImage(imageUrl) {
    const modal = document.getElementById('imageModal');
    const modalImg = document.getElementById('fullImage');
    modalImg.src = imageUrl;
    modal.classList.add('active');
}

function closeImageModal() {
    document.getElementById('imageModal').classList.remove('active');
}

function markPage(pageNum) {
    if (auth.currentUser && currentBook) {
        database.ref('bookmarks/' + auth.currentUser.uid + '/' + currentBook.id).set(pageNum);
        bookmarks[currentBook.id] = pageNum;
        showSlideAlert(`Página ${pageNum + 1} marcada com sucesso!`, 'success');
        showPages(currentBook);
    }
}

function loadUserBookmarks() {
    if (auth.currentUser) {
        database.ref('bookmarks/' + auth.currentUser.uid).on('value', (snapshot) => {
            bookmarks = snapshot.val() || {};
        });
    }
}


window.showMainLibrary = showMainLibrary;
window.loadBooks = loadBooks;
window.searchBooks = searchBooks;
window.viewBook = viewBook;
window.markPage = markPage;
window.loadUserBookmarks = loadUserBookmarks;
window.viewFullImage = viewFullImage;
window.closeImageModal = closeImageModal;
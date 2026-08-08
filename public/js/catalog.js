// ── REPLACE the existing renderReviews method inside the DetailsPage object ──
renderReviews(reviews) {
  if (reviews.length === 0) {
    $('#reviewsList').empty();
    $('#noReviewsMessage').removeClass('d-none');
    return;
  }

  $('#noReviewsMessage').addClass('d-none');
  const currentUser = TokenStore.getUser();

  const html = reviews
    .slice()
    .reverse()
    .map((review) => {
      const isOwner =
        currentUser &&
        review.user &&
        (review.user._id === currentUser.id || review.user === currentUser.id);

      return `
        <div class="review-item" data-review-id="${review._id}">
          <div class="d-flex justify-content-between align-items-start">
            <div>
              <div class="fw-semibold">${escapeHtml(review.name)}</div>
              <div class="review-stars-display">${renderStars(review.rating)}</div>
            </div>
            <div class="text-end">
              <span class="small text-muted d-block">${formatDate(review.createdAt)}</span>
              ${
                isOwner
                  ? `<div class="mt-1">
                      <button class="btn btn-link btn-sm p-0 me-2 edit-review-btn" data-review-id="${review._id}" data-rating="${review.rating}" data-comment="${escapeHtml(review.comment || '')}">Edit</button>
                      <button class="btn btn-link btn-sm p-0 text-danger delete-review-btn" data-review-id="${review._id}">Delete</button>
                    </div>`
                  : ''
              }
            </div>
          </div>
          <p class="mt-2 mb-0 small text-secondary review-comment-text">${escapeHtml(review.comment || '')}</p>
        </div>`;
    })
    .join('');

  $('#reviewsList').html(html);
},

// ── ADD this method inside the DetailsPage object to handle review actions ──
initReviewEditDelete(self) {
  // Edit — populate form in "edit mode"
  $(document).on('click', '.edit-review-btn', function () {
    const reviewId = $(this).data('review-id');
    const rating = parseInt($(this).data('rating'), 10);
    const comment = $(this).data('comment') || '';

    $('#reviewForm').data('editing-review-id', reviewId);
    $('#reviewRatingValue').val(rating);
    $('#reviewComment').val(comment);
    $('#reviewStarInput i').each(function () {
      $(this).toggleClass('active', parseInt($(this).data('value'), 10) <= rating);
    });
    $('#submitReviewBtn').text('Update Review');
    $('#addReviewCard').removeClass('d-none');
    $('html, body').animate({ scrollTop: $('#addReviewCard').offset().top - 100 }, 300);

    if ($('#cancelEditReviewBtn').length === 0) {
      $('#submitReviewBtn').after(
        '<button type="button" class="btn btn-outline-secondary btn-sm ms-2" id="cancelEditReviewBtn">Cancel</button>'
      );
    }
  });

  // Cancel edit mode
  $(document).on('click', '#cancelEditReviewBtn', function () {
    $('#reviewForm').removeData('editing-review-id');
    $('#reviewComment').val('');
    $('#reviewRatingValue').val(0);
    $('#reviewStarInput i').removeClass('active');
    $('#submitReviewBtn').text('Submit Review');
    $(this).remove();
  });

  // Delete
  $(document).on('click', '.delete-review-btn', function () {
    const reviewId = $(this).data('review-id');
    if (!confirm('Are you sure you want to delete your review? This cannot be undone.')) return;

    Api.delete(`/books/${self.currentBook._id}/reviews/${reviewId}`)
      .done(() => {
        Toast.success('Review deleted successfully');
        self.fetchBook($('#bookDetailsPage').data('slug'));
      })
      .fail((jqXHR) => {
        Toast.error(extractErrorMessage(jqXHR));
      });
  });
},

// ── REPLACE the existing #reviewForm submit handler with this version ──
// (Note: Place this inside the bindEvents() method)
$('#reviewForm').on('submit', function (e) {
  e.preventDefault();

  const rating = parseInt($('#reviewRatingValue').val(), 10);
  const comment = $('#reviewComment').val().trim();
  const editingReviewId = $(this).data('editing-review-id');

  if (!rating || rating < 1) {
    Toast.warning('Please select a star rating');
    return;
  }

  const $btn = $('#submitReviewBtn');
  ButtonState.loading($btn, editingReviewId ? ' Updating...' : ' Submitting...');

  const request = editingReviewId
    ? Api.put(`/books/${self.currentBook._id}/reviews/${editingReviewId}`, { rating, comment })
    : Api.post(`/books/${self.currentBook._id}/reviews`, { rating, comment });

  request
    .done(() => {
      Toast.success(editingReviewId ? 'Review updated successfully!' : 'Review submitted successfully!');
      $('#reviewComment').val('');
      $('#reviewRatingValue').val(0);
      $('#reviewStarInput i').removeClass('active');
      $('#reviewForm').removeData('editing-review-id');
      $('#submitReviewBtn').text('Submit Review');
      $('#cancelEditReviewBtn').remove();
      self.fetchBook($('#bookDetailsPage').data('slug'));
    })
    .fail((jqXHR) => {
      Toast.error(extractErrorMessage(jqXHR));
    })
    .always(() => {
      ButtonState.reset($btn);
    });
});

// Call this once at the end of bindEvents():
this.initReviewEditDelete(self);
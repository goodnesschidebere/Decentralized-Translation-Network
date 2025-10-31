;; TranslationCore.clar
(define-constant ERR-NOT-AUTHORIZED (err u100))
(define-constant ERR-REQUEST-CLOSED (err u101))
(define-constant ERR-INSUFFICIENT-BOUNTY (err u102))
(define-constant ERR-VERIFICATION-FAILED (err u103))
(define-constant ERR-ALREADY-SUBMITTED (err u104))
(define-constant ERR-INVALID-HASH (err u105))
(define-constant ERR-INVALID-LANG (err u106))
(define-constant ERR-INVALID-STATUS (err u107))
(define-constant ERR-REQUEST-NOT-FOUND (err u108))
(define-constant ERR-ESCROW-LOCKED (err u109))
(define-constant ERR-NO-TRANSLATION (err u110))

(define-data-var request-nonce uint u0)

(define-map TranslationRequests
  uint
  {
    creator: principal,
    content-hash: (string-ascii 64),
    source-lang: (string-ascii 10),
    target-lang: (string-ascii 10),
    bounty: uint,
    status: (string-ascii 20),
    created-at: uint,
    translator: (optional principal),
    translation-hash: (optional (string-ascii 64)),
    verification-count: uint,
    approval-threshold: uint
  }
)

(define-map Verifications
  { request-id: uint, verifier: principal }
  { approved: bool, timestamp: uint }
)

(define-read-only (get-request (id uint))
  (map-get? TranslationRequests id)
)

(define-read-only (get-verification (request-id uint) (verifier principal))
  (map-get? Verifications { request-id: request-id, verifier: verifier })
)

(define-read-only (is-verified (request-id uint))
  (let (
    (request (unwrap! (get-request request-id) false))
    (verifs (fold filter-verifications (map-keys Verifications) (list request-id)))
  )
    (>= (len verifs) (get approval-threshold request))
  )
)

(define-private (filter-verifications (key { request-id: uint, verifier: principal }) (acc (list uint)))
  (let ((verif (map-get? Verifications key)))
    (match verif
      v (if (and (is-eq (get request-id key) (get request-id (default-to { request-id: u0 } (some (get request-id (default-to { request-id: u0 } acc))))))
                (get approved v))
          (cons (get request-id key) acc)
          acc)
      acc)
  )
)

(define-private (valid-hash (hash (string-ascii 64)))
  (and (> (len hash) u0) (is-eq (len hash) u64))
)

(define-private (valid-lang (lang (string-ascii 10)))
  (and (> (len lang) u0) (<= (len lang) u10))
)

(define-private (validate-status (status (string-ascii 20)))
  (or
    (is-eq status "open")
    (is-eq status "submitted")
    (is-eq status "verifying")
    (is-eq status "approved")
    (is-eq status "rejected")
  )
)

(define-public (create-request
  (content-hash (string-ascii 64))
  (source-lang (string-ascii 10))
  (target-lang (string-ascii 10))
  (bounty uint)
  (approval-threshold uint)
)
  (let (
    (id (var-get request-nonce))
  )
    (asserts! (valid-hash content-hash) ERR-INVALID-HASH)
    (asserts! (valid-lang source-lang) ERR-INVALID-LANG)
    (asserts! (valid-lang target-lang) ERR-INVALID-LANG)
    (asserts! (> bounty u0) ERR-INSUFFICIENT-BOUNTY)
    (asserts! (and (>= approval-threshold u1) (<= approval-threshold u10)) ERR-INVALID-STATUS)
    (try! (stx-transfer? bounty tx-sender (as-contract tx-sender)))
    (map-set TranslationRequests id
      {
        creator: tx-sender,
        content-hash: content-hash,
        source-lang: source-lang,
        target-lang: target-lang,
        bounty: bounty,
        status: "open",
        created-at: block-height,
        translator: none,
        translation-hash: none,
        verification-count: u0,
        approval-threshold: approval-threshold
      }
    )
    (var-set request-nonce (+ id u1))
    (ok id)
  )
)

(define-public (submit-translation
  (request-id uint)
  (translation-hash (string-ascii 64))
)
  (let (
    (request (unwrap! (get-request request-id) ERR-REQUEST-NOT-FOUND))
  )
    (asserts! (is-eq (get status request) "open") ERR-REQUEST-CLOSED)
    (asserts! (valid-hash translation-hash) ERR-INVALID-HASH)
    (asserts! (is-none (get translator request)) ERR-ALREADY-SUBMITTED)
    (map-set TranslationRequests request-id
      (merge request
        {
          translator: (some tx-sender),
          translation-hash: (some translation-hash),
          status: "submitted"
        }
      )
    )
    (ok true)
  )
)

(define-public (start-verification (request-id uint))
  (let (
    (request (unwrap! (get-request request-id) ERR-REQUEST-NOT-FOUND))
  )
    (asserts! (is-eq (get status request) "submitted") ERR-INVALID-STATUS)
    (asserts! (is-some (get translator request)) ERR-NO-TRANSLATION)
    (map-set TranslationRequests request-id
      (merge request { status: "verifying" })
    )
    (ok true)
  )
)

(define-public (verify-translation
  (request-id uint)
  (approved bool)
)
  (let (
    (request (unwrap! (get-request request-id) ERR-REQUEST-NOT-FOUND))
    (existing (get-verification request-id tx-sender))
  )
    (asserts! (is-eq (get status request) "verifying") ERR-INVALID-STATUS)
    (asserts! (is-none existing) ERR-ALREADY-SUBMITTED)
    (map-set Verifications
      { request-id: request-id, verifier: tx-sender }
      { approved: approved, timestamp: block-height }
    )
    (let (
      (new-count (if approved (+ (get verification-count request) u1) (get verification-count request)))
      (updated-request (merge request { verification-count: new-count }))
    )
      (map-set TranslationRequests request-id updated-request)
      (if (and approved (>= new-count (get approval-threshold request)))
        (begin
          (map-set TranslationRequests request-id
            (merge updated-request { status: "approved" })
          )
          (try! (as-contract (stx-transfer? (get bounty request) tx-sender (unwrap! (get translator request) ERR-NO-TRANSLATION))))
          (ok u200)
        )
        (ok u201)
      )
    )
  )
)

(define-public (reject-request (request-id uint))
  (let (
    (request (unwrap! (get-request request-id) ERR-REQUEST-NOT-FOUND))
  )
    (asserts! (is-eq (get creator request) tx-sender) ERR-NOT-AUTHORIZED)
    (asserts! (not (is-eq (get status request) "approved")) ERR-REQUEST-CLOSED)
    (map-set TranslationRequests request-id
      (merge request { status: "rejected" })
    )
    (try! (as-contract (stx-transfer? (get bounty request) tx-sender tx-sender)))
    (ok true)
  )
)